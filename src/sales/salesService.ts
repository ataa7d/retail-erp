/**
 * Sales document service: creates and posts sales invoices (POS +
 * wholesale) and credit notes. Callers control the transaction (pass in a
 * connected pg Client already inside BEGIN/COMMIT) so that header + lines +
 * payments + journal + status-flip all land in one atomic unit, per rule E.
 *
 * Posting always follows the same order within that one transaction:
 *   1. insert/verify header + lines (draft)
 *   2. build the GL journal (draft) from the now-final line totals
 *   3. flip the journal to 'posted' (Phase 3's trigger validates balance)
 *   4. flip the invoice/credit note to 'posted' (this file's trigger
 *      validates the journal is posted, and for POS, that payments cover
 *      the total)
 */

import type { Client } from "pg";
import { calculateLineAmounts, type LineInput } from "../money.js";
import { recordStockMovement } from "../inventory/inventoryService.js";

export interface SalesInvoiceLineRequest extends LineInput {
  itemVariantId: string | null;
  itemDescription: string;
  lineType?: "item" | "charge";
}

export interface CreateSalesInvoiceParams {
  companyId: string;
  storeId: string;
  invoiceChannel: "pos" | "wholesale";
  zatcaInvoiceCategory: "simplified" | "standard";
  invoiceDate: string; // YYYY-MM-DD
  fiscalPeriodId: string;
  customerId: string | null;
  salespersonId: string | null;
  priceListId: string | null;
  createdBy: string | null;
  lines: SalesInvoiceLineRequest[];
  payments?: Array<{ paymentMethod: "cash" | "card" | "credit" | "points" | "gift_card"; amount: number; reference?: string }>;
  /** Set only by src/sync/syncService.ts: a device-assigned, already-final
   * document number bypasses fn_next_document_number entirely — the device's
   * own series, not the company-wide one, is authoritative for these. */
  documentNumberOverride?: string;
  issuedByDeviceId?: string | null;
  deviceSequenceNumber?: number | null;
  clientUuid?: string | null;
}

async function nextDocumentNumber(
  client: Client,
  companyId: string,
  documentType: string,
  fiscalYear: number,
  prefix: string,
): Promise<string> {
  const r = await client.query<{ fn_next_document_number: string }>(
    `SELECT fn_next_document_number($1, $2, $3, $4) AS fn_next_document_number`,
    [companyId, documentType, fiscalYear, prefix],
  );
  return r.rows[0]!.fn_next_document_number;
}

async function getAccountId(client: Client, companyId: string, code: string): Promise<string> {
  const r = await client.query<{ id: string }>(
    `SELECT id FROM chart_of_accounts WHERE company_id = $1 AND account_code = $2`,
    [companyId, code],
  );
  if (r.rows.length === 0) {
    throw new Error(`chart of accounts is missing required account ${code} for company ${companyId}`);
  }
  return r.rows[0]!.id;
}

export async function createSalesInvoice(client: Client, params: CreateSalesInvoiceParams): Promise<string> {
  const fiscalYear = Number(params.invoiceDate.slice(0, 4));
  const prefix = params.invoiceChannel === "pos" ? "POS-" : "WS-";
  const documentType = params.invoiceChannel === "pos" ? "pos_invoice" : "wholesale_invoice";
  const documentNumber =
    params.documentNumberOverride ?? (await nextDocumentNumber(client, params.companyId, documentType, fiscalYear, prefix));

  const header = await client.query<{ id: string }>(
    `INSERT INTO sales_invoices
       (company_id, store_id, invoice_channel, zatca_invoice_category, document_number,
        invoice_date, fiscal_period_id, customer_id, salesperson_id, price_list_id, created_by,
        issued_by_device_id, device_sequence_number, client_uuid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      params.companyId,
      params.storeId,
      params.invoiceChannel,
      params.zatcaInvoiceCategory,
      documentNumber,
      params.invoiceDate,
      params.fiscalPeriodId,
      params.customerId,
      params.salespersonId,
      params.priceListId,
      params.createdBy,
      params.issuedByDeviceId ?? null,
      params.deviceSequenceNumber ?? null,
      params.clientUuid ?? null,
    ],
  );
  const invoiceId = header.rows[0]!.id;

  let lineNumber = 0;
  for (const line of params.lines) {
    lineNumber += 1;
    const amounts = calculateLineAmounts(line);
    await client.query(
      `INSERT INTO sales_invoice_lines
         (company_id, invoice_id, line_number, line_type, item_variant_id, item_description,
          qty, unit_price, discount_amount, vat_rate, price_includes_vat,
          net_amount, vat_amount, gross_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        params.companyId,
        invoiceId,
        lineNumber,
        line.lineType ?? "item",
        line.itemVariantId,
        line.itemDescription,
        line.qty,
        line.unitPrice,
        line.discountAmount,
        line.vatRate,
        line.priceIncludesVat,
        amounts.netAmount,
        amounts.vatAmount,
        amounts.grossAmount,
      ],
    );
  }

  for (const payment of params.payments ?? []) {
    await client.query(
      `INSERT INTO sales_invoice_payments (company_id, invoice_id, payment_method, amount, reference)
       VALUES ($1, $2, $3, $4, $5)`,
      [params.companyId, invoiceId, payment.paymentMethod, payment.amount, payment.reference ?? null],
    );
  }

  return invoiceId;
}

export async function postSalesInvoice(client: Client, invoiceId: string, postedBy: string): Promise<void> {
  const invoiceResult = await client.query(
    `SELECT company_id, store_id, invoice_channel, invoice_date, fiscal_period_id, net_amount, vat_amount, gross_amount
     FROM sales_invoices WHERE id = $1`,
    [invoiceId],
  );
  if (invoiceResult.rows.length === 0) throw new Error(`sales invoice ${invoiceId} not found`);
  const invoice = invoiceResult.rows[0]!;

  if (invoice.invoice_channel === "pos") {
    const paid = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM sales_invoice_payments WHERE invoice_id = $1`,
      [invoiceId],
    );
    const paidTotal = paid.rows[0]!.total;
    if (Number(paidTotal) !== Number(invoice.gross_amount)) {
      // Same rule the check_sales_invoice_posting DB trigger enforces
      // independently (defense in depth) — checked here first for a
      // clearer error than "journal is not balanced", since an underpaid
      // invoice would otherwise only surface as a generic GL imbalance.
      throw new Error(
        `invoice ${invoiceId} payments (${paidTotal}) do not cover the total (${invoice.gross_amount})`,
      );
    }
  }

  const cashAccountId = await getAccountId(client, invoice.company_id, "1110");
  const arAccountId = await getAccountId(client, invoice.company_id, "1120");
  const vatAccountId = await getAccountId(client, invoice.company_id, "2110");
  const revenueAccountId = await getAccountId(client, invoice.company_id, "4110");

  const fiscalYear = Number(invoice.invoice_date.toISOString().slice(0, 4));
  // All journals share one numbering series ('journal') regardless of
  // source — a real general-journal voucher sequence, not per-module.
  const journalNumber = await nextDocumentNumber(client, invoice.company_id, "journal", fiscalYear, "GJ-");

  const journalResult = await client.query<{ id: string }>(
    `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type, source_id, created_by)
     VALUES ($1, $2, $3, $4, 'sales_invoice', $5, $6)
     RETURNING id`,
    [invoice.company_id, journalNumber, invoice.invoice_date, invoice.fiscal_period_id, invoiceId, postedBy],
  );
  const journalId = journalResult.rows[0]!.id;

  let lineNumber = 0;

  if (invoice.invoice_channel === "pos") {
    const payments = await client.query<{ payment_method: string; total: string }>(
      `SELECT payment_method, SUM(amount) AS total FROM sales_invoice_payments WHERE invoice_id = $1 GROUP BY payment_method`,
      [invoiceId],
    );
    for (const p of payments.rows) {
      lineNumber += 1;
      const accountId = p.payment_method === "credit" ? arAccountId : cashAccountId;
      await client.query(
        `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [invoice.company_id, journalId, lineNumber, accountId, p.total, `${p.payment_method} received`],
      );
    }
  } else {
    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'wholesale sale on credit')`,
      [invoice.company_id, journalId, lineNumber, arAccountId, invoice.gross_amount],
    );
  }

  lineNumber += 1;
  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
     VALUES ($1, $2, $3, $4, $5, 'sales revenue')`,
    [invoice.company_id, journalId, lineNumber, revenueAccountId, invoice.net_amount],
  );

  if (Number(invoice.vat_amount) > 0) {
    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'output VAT')`,
      [invoice.company_id, journalId, lineNumber, vatAccountId, invoice.vat_amount],
    );
  }

  // Issue stock for every item line and book matching COGS in the same
  // journal — revenue without matching COGS would misstate the period's
  // margin, so this is not deferred to a later phase.
  const itemLines = await client.query<{ id: string; item_variant_id: string; qty: string }>(
    `SELECT id, item_variant_id, qty FROM sales_invoice_lines WHERE invoice_id = $1 AND line_type = 'item'`,
    [invoiceId],
  );

  let totalCogs = 0;
  for (const line of itemLines.rows) {
    const movement = await recordStockMovement(client, {
      companyId: invoice.company_id,
      storeId: invoice.store_id,
      itemVariantId: line.item_variant_id,
      movementType: "issue",
      qty: -Math.abs(Number(line.qty)),
      sourceType: "sales_invoice",
      sourceId: invoiceId,
      sourceLineId: line.id,
      createdBy: postedBy,
    });
    totalCogs += Math.abs(movement.totalCost);
  }
  totalCogs = Math.round(totalCogs * 100) / 100;

  if (totalCogs > 0) {
    const cogsAccountId = await getAccountId(client, invoice.company_id, "5100");
    const inventoryAccountId = await getAccountId(client, invoice.company_id, "1130");

    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'cost of goods sold')`,
      [invoice.company_id, journalId, lineNumber, cogsAccountId, totalCogs],
    );
    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'inventory reduction')`,
      [invoice.company_id, journalId, lineNumber, inventoryAccountId, totalCogs],
    );
  }

  await client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journalId]);
  await client.query(
    `UPDATE sales_invoices SET document_status = 'posted', posted_by = $2, journal_id = $3 WHERE id = $1`,
    [invoiceId, postedBy, journalId],
  );
}

export interface CreditNoteLineRequest {
  sourceLineId: string;
  itemVariantId: string | null;
  itemDescription: string;
  qty: number;
  unitPrice: number;
  discountAmount: number;
  vatRate: number;
  priceIncludesVat: boolean;
}

export interface CreateCreditNoteParams {
  companyId: string;
  storeId: string;
  originalInvoiceId: string;
  zatcaInvoiceCategory: "simplified" | "standard";
  creditNoteDate: string;
  fiscalPeriodId: string;
  customerId: string | null;
  reason: string;
  createdBy: string | null;
  lines: CreditNoteLineRequest[];
  /** Set only by src/sync/syncService.ts — see the matching fields on
   * CreateSalesInvoiceParams. */
  documentNumberOverride?: string;
  issuedByDeviceId?: string | null;
  deviceSequenceNumber?: number | null;
  clientUuid?: string | null;
}

export async function createCreditNote(client: Client, params: CreateCreditNoteParams): Promise<string> {
  const fiscalYear = Number(params.creditNoteDate.slice(0, 4));
  const documentNumber =
    params.documentNumberOverride ?? (await nextDocumentNumber(client, params.companyId, "credit_note", fiscalYear, "CN-"));

  const header = await client.query<{ id: string }>(
    `INSERT INTO credit_notes
       (company_id, store_id, original_invoice_id, zatca_invoice_category, document_number,
        credit_note_date, fiscal_period_id, customer_id, reason, created_by,
        issued_by_device_id, device_sequence_number, client_uuid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      params.companyId,
      params.storeId,
      params.originalInvoiceId,
      params.zatcaInvoiceCategory,
      documentNumber,
      params.creditNoteDate,
      params.fiscalPeriodId,
      params.customerId,
      params.reason,
      params.createdBy,
      params.issuedByDeviceId ?? null,
      params.deviceSequenceNumber ?? null,
      params.clientUuid ?? null,
    ],
  );
  const creditNoteId = header.rows[0]!.id;

  let lineNumber = 0;
  for (const line of params.lines) {
    lineNumber += 1;
    // Fresh calculation from this line's own qty/price — never scaled or
    // copied from the source line's stored amounts.
    const amounts = calculateLineAmounts(line);
    await client.query(
      `INSERT INTO credit_note_lines
         (company_id, credit_note_id, line_number, source_line_id, item_variant_id, item_description,
          qty, unit_price, discount_amount, vat_rate, price_includes_vat,
          net_amount, vat_amount, gross_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        params.companyId,
        creditNoteId,
        lineNumber,
        line.sourceLineId,
        line.itemVariantId,
        line.itemDescription,
        line.qty,
        line.unitPrice,
        line.discountAmount,
        line.vatRate,
        line.priceIncludesVat,
        amounts.netAmount,
        amounts.vatAmount,
        amounts.grossAmount,
      ],
    );
  }

  return creditNoteId;
}

export async function postCreditNote(client: Client, creditNoteId: string, postedBy: string): Promise<void> {
  const cnResult = await client.query(
    `SELECT cn.company_id, cn.store_id, cn.credit_note_date, cn.fiscal_period_id, cn.net_amount, cn.vat_amount, cn.gross_amount,
            si.invoice_channel
     FROM credit_notes cn
     JOIN sales_invoices si ON si.id = cn.original_invoice_id
     WHERE cn.id = $1`,
    [creditNoteId],
  );
  if (cnResult.rows.length === 0) throw new Error(`credit note ${creditNoteId} not found`);
  const cn = cnResult.rows[0]!;

  const cashAccountId = await getAccountId(client, cn.company_id, "1110");
  const arAccountId = await getAccountId(client, cn.company_id, "1120");
  const vatAccountId = await getAccountId(client, cn.company_id, "2110");
  const returnsAccountId = await getAccountId(client, cn.company_id, "4120");

  const fiscalYear = Number(cn.credit_note_date.toISOString().slice(0, 4));
  const journalNumber = await nextDocumentNumber(client, cn.company_id, "journal", fiscalYear, "GJ-");

  const journalResult = await client.query<{ id: string }>(
    `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type, source_id, created_by)
     VALUES ($1, $2, $3, $4, 'credit_note', $5, $6)
     RETURNING id`,
    [cn.company_id, journalNumber, cn.credit_note_date, cn.fiscal_period_id, creditNoteId, postedBy],
  );
  const journalId = journalResult.rows[0]!.id;

  let lineNumber = 1;
  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
     VALUES ($1, $2, $3, $4, $5, 'sales return')`,
    [cn.company_id, journalId, lineNumber, returnsAccountId, cn.net_amount],
  );

  if (Number(cn.vat_amount) > 0) {
    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'output VAT reversal')`,
      [cn.company_id, journalId, lineNumber, vatAccountId, cn.vat_amount],
    );
  }

  lineNumber += 1;
  const refundAccountId = cn.invoice_channel === "pos" ? cashAccountId : arAccountId;
  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
     VALUES ($1, $2, $3, $4, $5, 'refund / AR reduction')`,
    [cn.company_id, journalId, lineNumber, refundAccountId, cn.gross_amount],
  );

  // Receive the returned stock back at exactly the cost it was issued at
  // on the original sale (never today's average — that would misstate the
  // COGS reversal), and reverse that same amount of COGS.
  const cnLines = await client.query<{ id: string; item_variant_id: string | null; qty: string; source_line_id: string }>(
    `SELECT id, item_variant_id, qty, source_line_id FROM credit_note_lines WHERE credit_note_id = $1`,
    [creditNoteId],
  );

  let totalCogsReversal = 0;
  for (const line of cnLines.rows) {
    if (!line.item_variant_id) continue;

    const originalIssue = await client.query<{ unit_cost: string }>(
      `SELECT unit_cost FROM stock_movements
       WHERE source_type = 'sales_invoice' AND source_line_id = $1 AND movement_type = 'issue'
       ORDER BY created_at LIMIT 1`,
      [line.source_line_id],
    );
    if (originalIssue.rows.length === 0) {
      throw new Error(`no original issue movement found for source line ${line.source_line_id}; was the original invoice posted?`);
    }
    const originalUnitCost = Number(originalIssue.rows[0]!.unit_cost);

    const movement = await recordStockMovement(client, {
      companyId: cn.company_id,
      storeId: cn.store_id,
      itemVariantId: line.item_variant_id,
      movementType: "sales_return",
      qty: Math.abs(Number(line.qty)),
      explicitUnitCost: originalUnitCost,
      sourceType: "credit_note",
      sourceId: creditNoteId,
      sourceLineId: line.id,
      createdBy: postedBy,
    });
    totalCogsReversal += movement.totalCost;
  }
  totalCogsReversal = Math.round(totalCogsReversal * 100) / 100;

  if (totalCogsReversal > 0) {
    const cogsAccountId = await getAccountId(client, cn.company_id, "5100");
    const inventoryAccountId = await getAccountId(client, cn.company_id, "1130");

    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'inventory increase on return')`,
      [cn.company_id, journalId, lineNumber, inventoryAccountId, totalCogsReversal],
    );
    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'COGS reversal on return')`,
      [cn.company_id, journalId, lineNumber, cogsAccountId, totalCogsReversal],
    );
  }

  await client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journalId]);
  await client.query(
    `UPDATE credit_notes SET document_status = 'posted', posted_by = $2, journal_id = $3 WHERE id = $1`,
    [creditNoteId, postedBy, journalId],
  );
}
