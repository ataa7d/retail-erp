/**
 * Purchasing service: purchase orders, goods receipts (with landed-cost
 * allocation), supplier invoices (3-way match), and supplier credit notes.
 *
 * The accrual chain, all in one company's books:
 *   PO (commitment, no GL) --receive--> GRNI liability + Inventory asset
 *     --invoice--> GRNI cleared, price variance booked, VAT claimed, AP credited
 *     --return-->  AP reduced, Inventory reduced, VAT claim reduced
 */

import type { Client } from "pg";
import { allocateAmount, calculateLineAmounts, round2, type LineInput } from "../money.js";
import { recordStockMovement } from "../inventory/inventoryService.js";
import { getBaseCurrency, resolveExchangeRate, round4 } from "../currency/exchangeRates.js";

async function nextDocumentNumber(client: Client, companyId: string, documentType: string, fiscalYear: number, prefix: string) {
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

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export interface PurchaseOrderLineRequest extends LineInput {
  itemVariantId: string;
}

export interface CreatePurchaseOrderParams {
  companyId: string;
  storeId: string;
  supplierId: string;
  orderDate: string;
  expectedDate?: string | null;
  fiscalPeriodId: string;
  createdBy?: string | null;
  lines: PurchaseOrderLineRequest[];
  /** Transaction currency; defaults to the company's base currency. */
  currency?: string | null;
  /** Indicative rate at order date (a PO posts no GL, so this is informational). */
  exchangeRate?: number | null;
}

export async function createPurchaseOrder(client: Client, p: CreatePurchaseOrderParams): Promise<string> {
  const fiscalYear = Number(p.orderDate.slice(0, 4));
  const documentNumber = await nextDocumentNumber(client, p.companyId, "purchase_order", fiscalYear, "PO-");
  const currency = p.currency ?? (await getBaseCurrency(client, p.companyId));
  const exchangeRate = await resolveExchangeRate(client, p.companyId, currency, p.orderDate, p.exchangeRate);

  const header = await client.query<{ id: string }>(
    `INSERT INTO purchase_orders
       (company_id, store_id, supplier_id, document_number, order_date, expected_date, fiscal_period_id, created_by, currency, exchange_rate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [p.companyId, p.storeId, p.supplierId, documentNumber, p.orderDate, p.expectedDate ?? null, p.fiscalPeriodId, p.createdBy ?? null, currency, exchangeRate],
  );
  const poId = header.rows[0]!.id;

  let lineNumber = 0;
  for (const line of p.lines) {
    lineNumber += 1;
    const amounts = calculateLineAmounts(line);
    await client.query(
      `INSERT INTO purchase_order_lines
         (company_id, purchase_order_id, line_number, item_variant_id, qty, unit_price,
          discount_amount, vat_rate, price_includes_vat, net_amount, vat_amount, gross_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        p.companyId, poId, lineNumber, line.itemVariantId, line.qty, line.unitPrice,
        line.discountAmount, line.vatRate, line.priceIncludesVat,
        amounts.netAmount, amounts.vatAmount, amounts.grossAmount,
      ],
    );

    // Keep the supplier's cost catalog (supplier_item_prices) current with
    // what was actually just ordered -- net of VAT, since input VAT is
    // reclaimed separately and isn't part of the item's cost. This is a
    // "last PO wins" update, not a negotiated-price change requiring
    // approval: placing a PO at a new cost is itself the record of that
    // new cost. Kept in the PO's own currency (a USD supplier's catalog
    // is in USD), so it never drifts with the exchange rate.
    const netUnitCost = round2(amounts.netAmount / line.qty);
    await client.query(
      `INSERT INTO supplier_item_prices (company_id, supplier_id, item_variant_id, unit_cost, currency)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (supplier_id, item_variant_id)
         DO UPDATE SET unit_cost = EXCLUDED.unit_cost, currency = EXCLUDED.currency, is_active = true`,
      [p.companyId, p.supplierId, line.itemVariantId, netUnitCost, currency],
    );
  }

  return poId;
}

export async function postPurchaseOrder(client: Client, poId: string, postedBy: string): Promise<void> {
  await client.query(`UPDATE purchase_orders SET document_status = 'posted', posted_by = $2 WHERE id = $1`, [poId, postedBy]);
}

// ---------------------------------------------------------------------------
// Goods receipts
// ---------------------------------------------------------------------------

export interface GoodsReceiptLineRequest {
  purchaseOrderLineId: string;
  itemVariantId: string;
  qtyReceived: number;
}

export interface GoodsReceiptChargeRequest {
  chargeType: string;
  amount: number;
  allocationBasis?: "value" | "weight";
  description?: string;
}

export interface CreateGoodsReceiptParams {
  companyId: string;
  storeId: string;
  purchaseOrderId: string;
  supplierId: string;
  receiptDate: string;
  fiscalPeriodId: string;
  createdBy?: string | null;
  lines: GoodsReceiptLineRequest[];
  /** Landed-cost charges are in the base currency (customs, clearing and local freight are paid locally). */
  charges?: GoodsReceiptChargeRequest[];
  /** Rate on the receipt date; looked up from exchange_rates when omitted. Currency always comes from the PO. */
  exchangeRate?: number | null;
}

export async function createGoodsReceipt(client: Client, p: CreateGoodsReceiptParams): Promise<string> {
  const fiscalYear = Number(p.receiptDate.slice(0, 4));
  const documentNumber = await nextDocumentNumber(client, p.companyId, "goods_receipt", fiscalYear, "GR-");

  const po = await client.query<{ currency: string }>(`SELECT currency FROM purchase_orders WHERE id = $1`, [p.purchaseOrderId]);
  if (po.rows.length === 0) throw new Error(`purchase order ${p.purchaseOrderId} not found`);
  const currency = po.rows[0]!.currency;
  const exchangeRate = await resolveExchangeRate(client, p.companyId, currency, p.receiptDate, p.exchangeRate);

  const header = await client.query<{ id: string }>(
    `INSERT INTO goods_receipts
       (company_id, store_id, purchase_order_id, supplier_id, document_number, receipt_date, fiscal_period_id, created_by, currency, exchange_rate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [p.companyId, p.storeId, p.purchaseOrderId, p.supplierId, documentNumber, p.receiptDate, p.fiscalPeriodId, p.createdBy ?? null, currency, exchangeRate],
  );
  const receiptId = header.rows[0]!.id;

  let lineNumber = 0;
  for (const line of p.lines) {
    lineNumber += 1;
    const poLine = await client.query<{ unit_price: string }>(
      `SELECT unit_price FROM purchase_order_lines WHERE id = $1`,
      [line.purchaseOrderLineId],
    );
    if (poLine.rows.length === 0) throw new Error(`purchase order line ${line.purchaseOrderLineId} not found`);
    const baseUnitCost = Number(poLine.rows[0]!.unit_price);
    const baseCurrencyUnitCost = round4(baseUnitCost * exchangeRate);

    await client.query(
      `INSERT INTO goods_receipt_lines
         (company_id, goods_receipt_id, line_number, purchase_order_line_id, item_variant_id,
          qty_received, base_unit_cost, base_currency_unit_cost, unit_cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`, // unit_cost starts at the translated merchandise cost; landed cost updates it at posting
      [p.companyId, receiptId, lineNumber, line.purchaseOrderLineId, line.itemVariantId, line.qtyReceived, baseUnitCost, baseCurrencyUnitCost],
    );
  }

  for (const charge of p.charges ?? []) {
    await client.query(
      `INSERT INTO goods_receipt_charges (company_id, goods_receipt_id, charge_type, amount, allocation_basis, description)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [p.companyId, receiptId, charge.chargeType, charge.amount, charge.allocationBasis ?? "value", charge.description ?? null],
    );
  }

  return receiptId;
}

export async function postGoodsReceipt(client: Client, receiptId: string, postedBy: string): Promise<void> {
  const receiptResult = await client.query(
    `SELECT company_id, store_id, receipt_date, fiscal_period_id FROM goods_receipts WHERE id = $1`,
    [receiptId],
  );
  if (receiptResult.rows.length === 0) throw new Error(`goods receipt ${receiptId} not found`);
  const receipt = receiptResult.rows[0]!;

  // Everything from here on is base currency: base_currency_unit_cost is the
  // merchandise cost already translated at the receipt rate.
  const lines = await client.query<{ id: string; item_variant_id: string; qty_received: string; base_currency_unit_cost: string }>(
    `SELECT id, item_variant_id, qty_received, base_currency_unit_cost FROM goods_receipt_lines WHERE goods_receipt_id = $1 ORDER BY line_number`,
    [receiptId],
  );
  if (lines.rows.length === 0) throw new Error(`goods receipt ${receiptId} has no lines`);

  const charges = await client.query<{ amount: string; allocation_basis: string }>(
    `SELECT amount, allocation_basis FROM goods_receipt_charges WHERE goods_receipt_id = $1`,
    [receiptId],
  );

  // Landed cost allocation, once, by value or by weight, using the same
  // remainder-to-last-line allocator as everywhere else in this codebase.
  const landedCostByLine = new Map<string, number>(lines.rows.map((l) => [l.id, 0]));

  if (charges.rows.length > 0) {
    const weights = new Map<string, { value: number; weight: number }>();
    for (const line of lines.rows) {
      const itemWeightResult = await client.query<{ weight_kg: string | null }>(
        `SELECT iv.item_id, i.weight_kg FROM item_variants iv JOIN items i ON i.id = iv.item_id WHERE iv.id = $1`,
        [line.item_variant_id],
      );
      const weightKg = Number(itemWeightResult.rows[0]?.weight_kg ?? 0);
      weights.set(line.id, {
        value: Number(line.qty_received) * Number(line.base_currency_unit_cost),
        weight: Number(line.qty_received) * weightKg,
      });
    }

    for (const charge of charges.rows) {
      const basis = charge.allocation_basis === "weight" ? "weight" : "value";
      const lineIds = lines.rows.map((l) => l.id);
      const lineWeights = lineIds.map((id) => weights.get(id)![basis]);

      if (basis === "weight" && lineWeights.every((w) => w === 0)) {
        throw new Error(`goods receipt ${receiptId}: weight-based charge allocation requires items.weight_kg to be set`);
      }

      const allocated = allocateAmount(Number(charge.amount), lineWeights);
      lineIds.forEach((id, i) => {
        landedCostByLine.set(id, round2(landedCostByLine.get(id)! + allocated[i]!));
      });
    }
  }

  let totalMerchandiseValue = 0;
  for (const line of lines.rows) {
    const landedCostAmount = landedCostByLine.get(line.id)!;
    const qtyReceived = Number(line.qty_received);
    const merchandiseUnitCost = Number(line.base_currency_unit_cost);
    // Per-line rounding, the same formula the supplier invoice uses when it
    // clears this line's GRNI -- so a fully invoiced receipt clears to zero.
    totalMerchandiseValue = round2(totalMerchandiseValue + round2(qtyReceived * merchandiseUnitCost));
    const unitCost = round4(merchandiseUnitCost + landedCostAmount / qtyReceived);

    await client.query(
      `UPDATE goods_receipt_lines SET landed_cost_amount = $2, unit_cost = $3 WHERE id = $1`,
      [line.id, landedCostAmount, unitCost],
    );

    await recordStockMovement(client, {
      companyId: receipt.company_id,
      storeId: receipt.store_id,
      itemVariantId: line.item_variant_id,
      movementType: "receipt",
      qty: qtyReceived,
      explicitUnitCost: unitCost,
      sourceType: "goods_receipt",
      sourceId: receiptId,
      sourceLineId: line.id,
      createdBy: postedBy,
    });
  }

  const totalLandedValue = round2(Array.from(landedCostByLine.values()).reduce((s, v) => s + v, 0));
  const totalInventoryValue = round2(totalMerchandiseValue + totalLandedValue);

  const inventoryAccountId = await getAccountId(client, receipt.company_id, "1130");
  const grniAccountId = await getAccountId(client, receipt.company_id, "2120");
  const landedCostAccountId = await getAccountId(client, receipt.company_id, "2140");

  const fiscalYear = Number(receipt.receipt_date.toISOString().slice(0, 4));
  const journalNumber = await nextDocumentNumber(client, receipt.company_id, "journal", fiscalYear, "GJ-");
  const journalResult = await client.query<{ id: string }>(
    `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type, source_id, created_by)
     VALUES ($1, $2, $3, $4, 'goods_receipt', $5, $6) RETURNING id`,
    [receipt.company_id, journalNumber, receipt.receipt_date, receipt.fiscal_period_id, receiptId, postedBy],
  );
  const journalId = journalResult.rows[0]!.id;

  let lineNumber = 1;
  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
     VALUES ($1, $2, $3, $4, $5, 'goods received')`,
    [receipt.company_id, journalId, lineNumber, inventoryAccountId, totalInventoryValue],
  );

  lineNumber += 1;
  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
     VALUES ($1, $2, $3, $4, $5, 'GRNI accrual')`,
    [receipt.company_id, journalId, lineNumber, grniAccountId, totalMerchandiseValue],
  );

  if (totalLandedValue > 0) {
    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'landed cost accrual')`,
      [receipt.company_id, journalId, lineNumber, landedCostAccountId, totalLandedValue],
    );
  }

  await client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journalId]);
  await client.query(
    `UPDATE goods_receipts SET document_status = 'posted', posted_by = $2, journal_id = $3 WHERE id = $1`,
    [receiptId, postedBy, journalId],
  );
}

// ---------------------------------------------------------------------------
// Supplier invoices
// ---------------------------------------------------------------------------

export interface SupplierInvoiceLineRequest {
  goodsReceiptLineId: string;
  itemVariantId: string;
  qty: number;
  unitPrice: number;
  discountAmount: number;
  vatRate: number;
  priceIncludesVat: boolean;
}

export interface CreateSupplierInvoiceParams {
  companyId: string;
  supplierId: string;
  purchaseOrderId: string;
  supplierInvoiceNumber: string;
  invoiceDate: string;
  fiscalPeriodId: string;
  createdBy?: string | null;
  lines: SupplierInvoiceLineRequest[];
  /** Rate on the invoice date; looked up when omitted. Currency always comes from the PO. */
  exchangeRate?: number | null;
}

export async function createSupplierInvoice(client: Client, p: CreateSupplierInvoiceParams): Promise<string> {
  const fiscalYear = Number(p.invoiceDate.slice(0, 4));
  const documentNumber = await nextDocumentNumber(client, p.companyId, "supplier_invoice", fiscalYear, "SI-");

  const po = await client.query<{ currency: string }>(`SELECT currency FROM purchase_orders WHERE id = $1`, [p.purchaseOrderId]);
  if (po.rows.length === 0) throw new Error(`purchase order ${p.purchaseOrderId} not found`);
  const currency = po.rows[0]!.currency;
  const exchangeRate = await resolveExchangeRate(client, p.companyId, currency, p.invoiceDate, p.exchangeRate);

  const header = await client.query<{ id: string }>(
    `INSERT INTO supplier_invoices
       (company_id, supplier_id, purchase_order_id, supplier_invoice_number, document_number, invoice_date, fiscal_period_id, created_by, currency, exchange_rate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [p.companyId, p.supplierId, p.purchaseOrderId, p.supplierInvoiceNumber, documentNumber, p.invoiceDate, p.fiscalPeriodId, p.createdBy ?? null, currency, exchangeRate],
  );
  const invoiceId = header.rows[0]!.id;

  let lineNumber = 0;
  for (const line of p.lines) {
    lineNumber += 1;
    const amounts = calculateLineAmounts(line);
    await client.query(
      `INSERT INTO supplier_invoice_lines
         (company_id, supplier_invoice_id, line_number, goods_receipt_line_id, item_variant_id,
          qty, unit_price, discount_amount, vat_rate, price_includes_vat, net_amount, vat_amount, gross_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        p.companyId, invoiceId, lineNumber, line.goodsReceiptLineId, line.itemVariantId,
        line.qty, line.unitPrice, line.discountAmount, line.vatRate, line.priceIncludesVat,
        amounts.netAmount, amounts.vatAmount, amounts.grossAmount,
      ],
    );
  }

  return invoiceId;
}

export async function postSupplierInvoice(client: Client, invoiceId: string, postedBy: string): Promise<void> {
  const invoiceResult = await client.query(
    `SELECT company_id, invoice_date, fiscal_period_id, net_amount, vat_amount, gross_amount, currency, exchange_rate
     FROM supplier_invoices WHERE id = $1`,
    [invoiceId],
  );
  if (invoiceResult.rows.length === 0) throw new Error(`supplier invoice ${invoiceId} not found`);
  const invoice = invoiceResult.rows[0]!;
  const invoiceRate = Number(invoice.exchange_rate);
  const isBaseCurrency = invoice.currency === (await getBaseCurrency(client, invoice.company_id));

  const grniAccountId = await getAccountId(client, invoice.company_id, "2120");
  const apAccountId = await getAccountId(client, invoice.company_id, "2130");
  const vatAccountId = await getAccountId(client, invoice.company_id, "1140");
  const priceVarianceAccountId = await getAccountId(client, invoice.company_id, "5120");

  const lines = await client.query<{ goods_receipt_line_id: string; qty: string; net_amount: string }>(
    `SELECT goods_receipt_line_id, qty, net_amount FROM supplier_invoice_lines WHERE supplier_invoice_id = $1`,
    [invoiceId],
  );

  // Three separate things can make the AP amount differ from the GRNI
  // accrued at receipt, and each goes to its own account:
  //   GRNI clear  - exactly what the receipt accrued, at the receipt rate
  //   price var.  - supplier's price vs the PO price, in the invoice
  //                 currency, translated at the invoice rate
  //   FX diff     - the rate moving between receipt and invoice (the
  //                 balancing figure, so it also absorbs rounding)
  let totalGrniClear = 0;
  let foreignVariance = 0; // positive = supplier charged more than the PO price
  for (const line of lines.rows) {
    const grLine = await client.query<{ base_unit_cost: string; base_currency_unit_cost: string }>(
      `SELECT base_unit_cost, base_currency_unit_cost FROM goods_receipt_lines WHERE id = $1`,
      [line.goods_receipt_line_id],
    );
    const qty = Number(line.qty);
    totalGrniClear = round2(totalGrniClear + round2(qty * Number(grLine.rows[0]!.base_currency_unit_cost)));
    foreignVariance += Number(line.net_amount) - qty * Number(grLine.rows[0]!.base_unit_cost);
  }

  const baseGross = round2(Number(invoice.gross_amount) * invoiceRate);
  const baseVat = round2(Number(invoice.vat_amount) * invoiceRate);
  const baseNet = round2(baseGross - baseVat);
  // In the base currency there is no FX by definition: all of the gap
  // between what's invoiced and what was accrued is price variance.
  const totalVariance = isBaseCurrency ? round2(baseNet - totalGrniClear) : round2(foreignVariance * invoiceRate);
  const fxDifference = isBaseCurrency ? 0 : round2(baseNet - totalGrniClear - totalVariance); // positive = loss

  const fiscalYear = Number(invoice.invoice_date.toISOString().slice(0, 4));
  const journalNumber = await nextDocumentNumber(client, invoice.company_id, "journal", fiscalYear, "GJ-");
  const journalResult = await client.query<{ id: string }>(
    `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type, source_id, created_by)
     VALUES ($1, $2, $3, $4, 'supplier_invoice', $5, $6) RETURNING id`,
    [invoice.company_id, journalNumber, invoice.invoice_date, invoice.fiscal_period_id, invoiceId, postedBy],
  );
  const journalId = journalResult.rows[0]!.id;

  let lineNumber = 1;
  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
     VALUES ($1, $2, $3, $4, $5, 'GRNI clearance')`,
    [invoice.company_id, journalId, lineNumber, grniAccountId, totalGrniClear],
  );

  if (totalVariance > 0) {
    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'unfavorable purchase price variance')`,
      [invoice.company_id, journalId, lineNumber, priceVarianceAccountId, totalVariance],
    );
  } else if (totalVariance < 0) {
    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'favorable purchase price variance')`,
      [invoice.company_id, journalId, lineNumber, priceVarianceAccountId, Math.abs(totalVariance)],
    );
  }

  if (fxDifference !== 0) {
    const fxAccountId = await getAccountId(client, invoice.company_id, "5400");
    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, ${fxDifference > 0 ? "debit_amount" : "credit_amount"}, description)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        invoice.company_id, journalId, lineNumber, fxAccountId, Math.abs(fxDifference),
        `realized FX ${fxDifference > 0 ? "loss" : "gain"} (${invoice.currency} rate moved between receipt and invoice)`,
      ],
    );
  }

  if (baseVat > 0) {
    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'input VAT')`,
      [invoice.company_id, journalId, lineNumber, vatAccountId, baseVat],
    );
  }

  lineNumber += 1;
  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      invoice.company_id, journalId, lineNumber, apAccountId, baseGross,
      isBaseCurrency ? "accounts payable" : `accounts payable (${invoice.currency} ${Number(invoice.gross_amount).toFixed(2)} @ ${invoiceRate})`,
    ],
  );

  await client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journalId]);
  await client.query(
    `UPDATE supplier_invoices
     SET document_status = 'posted', posted_by = $2, journal_id = $3,
         base_net_amount = $4, base_vat_amount = $5, base_gross_amount = $6
     WHERE id = $1`,
    [invoiceId, postedBy, journalId, baseNet, baseVat, baseGross],
  );
}

// ---------------------------------------------------------------------------
// Supplier credit notes (purchase returns)
// ---------------------------------------------------------------------------

export interface SupplierCreditNoteLineRequest {
  sourceLineId: string;
  itemVariantId: string;
  qty: number;
  unitPrice: number;
  discountAmount: number;
  vatRate: number;
  priceIncludesVat: boolean;
}

export interface CreateSupplierCreditNoteParams {
  companyId: string;
  storeId: string;
  supplierId: string;
  originalInvoiceId: string;
  creditNoteDate: string;
  fiscalPeriodId: string;
  reason: string;
  createdBy?: string | null;
  lines: SupplierCreditNoteLineRequest[];
}

export async function createSupplierCreditNote(client: Client, p: CreateSupplierCreditNoteParams): Promise<string> {
  const fiscalYear = Number(p.creditNoteDate.slice(0, 4));
  const documentNumber = await nextDocumentNumber(client, p.companyId, "supplier_credit_note", fiscalYear, "SCN-");

  const header = await client.query<{ id: string }>(
    `INSERT INTO supplier_credit_notes
       (company_id, store_id, supplier_id, original_invoice_id, document_number, credit_note_date, fiscal_period_id, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [p.companyId, p.storeId, p.supplierId, p.originalInvoiceId, documentNumber, p.creditNoteDate, p.fiscalPeriodId, p.reason, p.createdBy ?? null],
  );
  const creditNoteId = header.rows[0]!.id;

  let lineNumber = 0;
  for (const line of p.lines) {
    lineNumber += 1;
    const amounts = calculateLineAmounts(line);
    await client.query(
      `INSERT INTO supplier_credit_note_lines
         (company_id, supplier_credit_note_id, line_number, source_line_id, item_variant_id,
          qty, unit_price, discount_amount, vat_rate, price_includes_vat, net_amount, vat_amount, gross_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        p.companyId, creditNoteId, lineNumber, line.sourceLineId, line.itemVariantId,
        line.qty, line.unitPrice, line.discountAmount, line.vatRate, line.priceIncludesVat,
        amounts.netAmount, amounts.vatAmount, amounts.grossAmount,
      ],
    );
  }

  return creditNoteId;
}

export async function postSupplierCreditNote(client: Client, creditNoteId: string, postedBy: string): Promise<void> {
  // A return against a foreign-currency invoice reverses AP/VAT at that
  // invoice's own rate, so the amounts relieved match what was booked.
  const cnResult = await client.query(
    `SELECT cn.company_id, cn.store_id, cn.credit_note_date, cn.fiscal_period_id,
            ROUND(cn.net_amount * si.exchange_rate, 2) AS net_amount,
            ROUND(cn.vat_amount * si.exchange_rate, 2) AS vat_amount,
            ROUND(cn.net_amount * si.exchange_rate, 2) + ROUND(cn.vat_amount * si.exchange_rate, 2) AS gross_amount
     FROM supplier_credit_notes cn
     JOIN supplier_invoices si ON si.id = cn.original_invoice_id
     WHERE cn.id = $1`,
    [creditNoteId],
  );
  if (cnResult.rows.length === 0) throw new Error(`supplier credit note ${creditNoteId} not found`);
  const cn = cnResult.rows[0]!;

  const apAccountId = await getAccountId(client, cn.company_id, "2130");
  const inventoryAccountId = await getAccountId(client, cn.company_id, "1130");
  const vatAccountId = await getAccountId(client, cn.company_id, "1140");
  const priceVarianceAccountId = await getAccountId(client, cn.company_id, "5120");

  // Ship the returned stock back out FIRST. Under weighted-average costing
  // an outgoing movement is always costed at whatever the running average
  // happens to be right now (fn_process_stock_movement enforces this
  // unconditionally, same as any other issue) — it will generally NOT
  // equal the credit note's invoiced value, since the average may have
  // drifted since the goods were received. The gap between what we're
  // crediting AP for and what actually left inventory is a real purchase
  // price variance, not something to paper over by crediting Inventory at
  // the invoiced amount.
  const cnLines = await client.query<{ id: string; item_variant_id: string; qty: string }>(
    `SELECT id, item_variant_id, qty FROM supplier_credit_note_lines WHERE supplier_credit_note_id = $1`,
    [creditNoteId],
  );
  let actualInventoryReduction = 0;
  for (const line of cnLines.rows) {
    const movement = await recordStockMovement(client, {
      companyId: cn.company_id,
      storeId: cn.store_id,
      itemVariantId: line.item_variant_id,
      movementType: "purchase_return",
      qty: -Math.abs(Number(line.qty)),
      sourceType: "supplier_credit_note",
      sourceId: creditNoteId,
      sourceLineId: line.id,
      createdBy: postedBy,
    });
    actualInventoryReduction += Math.abs(movement.totalCost);
  }
  actualInventoryReduction = round2(actualInventoryReduction);

  const fiscalYear = Number(cn.credit_note_date.toISOString().slice(0, 4));
  const journalNumber = await nextDocumentNumber(client, cn.company_id, "journal", fiscalYear, "GJ-");
  const journalResult = await client.query<{ id: string }>(
    `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type, source_id, created_by)
     VALUES ($1, $2, $3, $4, 'supplier_credit_note', $5, $6) RETURNING id`,
    [cn.company_id, journalNumber, cn.credit_note_date, cn.fiscal_period_id, creditNoteId, postedBy],
  );
  const journalId = journalResult.rows[0]!.id;

  let lineNumber = 1;
  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
     VALUES ($1, $2, $3, $4, $5, 'accounts payable reduction')`,
    [cn.company_id, journalId, lineNumber, apAccountId, cn.gross_amount],
  );

  lineNumber += 1;
  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
     VALUES ($1, $2, $3, $4, $5, 'inventory reduction (purchase return, at current average cost)')`,
    [cn.company_id, journalId, lineNumber, inventoryAccountId, actualInventoryReduction],
  );

  if (Number(cn.vat_amount) > 0) {
    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'input VAT reversal')`,
      [cn.company_id, journalId, lineNumber, vatAccountId, cn.vat_amount],
    );
  }

  // net (invoiced value) vs actual cost removed from inventory.
  const variance = round2(Number(cn.net_amount) - actualInventoryReduction);
  if (variance > 0) {
    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'purchase price variance on return')`,
      [cn.company_id, journalId, lineNumber, priceVarianceAccountId, variance],
    );
  } else if (variance < 0) {
    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'purchase price variance on return')`,
      [cn.company_id, journalId, lineNumber, priceVarianceAccountId, Math.abs(variance)],
    );
  }

  await client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journalId]);
  await client.query(
    `UPDATE supplier_credit_notes SET document_status = 'posted', posted_by = $2, journal_id = $3 WHERE id = $1`,
    [creditNoteId, postedBy, journalId],
  );
}
