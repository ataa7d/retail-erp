import type { Client, Pool } from "pg";
import { buildZatcaQrPayload } from "./qrCode.js";
import { buildZatcaInvoiceXml, buildZatcaCreditNoteXml, vatCategoryFromRate, type UblParty, type UblLine } from "./ublXml.js";
import { computeInvoiceHash, getPreviousInvoiceHash } from "./invoiceHash.js";

type Queryable = Pool | Client;

const PAYMENT_MEANS_CODE: Record<string, string> = {
  cash: "10",
  card: "48",
  credit: "1",
  points: "1",
  gift_card: "1",
};

function toIsoDateParts(date: Date): { issueDate: string; issueTime: string } {
  const iso = date.toISOString();
  return { issueDate: iso.slice(0, 10), issueTime: iso.slice(11, 19) };
}

async function loadSupplierParty(client: Queryable, storeId: string, companyId: string): Promise<UblParty> {
  const r = await client.query<{
    registration_name: string;
    branch_cr: string | null;
    branch_vat: string | null;
    company_cr: string | null;
    company_vat: string | null;
    address: string | null;
    city: string | null;
  }>(
    `SELECT c.name_en AS registration_name,
            b.cr_number AS branch_cr, b.vat_registration_number AS branch_vat,
            c.cr_number AS company_cr, c.vat_registration_number AS company_vat,
            b.address, b.city
     FROM stores s
     JOIN branches b ON b.id = s.branch_id
     JOIN companies c ON c.id = s.company_id
     WHERE s.id = $1 AND s.company_id = $2`,
    [storeId, companyId],
  );
  const row = r.rows[0];
  if (!row) throw new Error(`store ${storeId} not found for company ${companyId}`);
  return {
    registrationName: row.registration_name,
    vatNumber: row.branch_vat ?? row.company_vat,
    crNumber: row.branch_cr ?? row.company_cr,
    address: row.address,
    city: row.city,
  };
}

async function loadCustomerParty(client: Queryable, customerId: string | null): Promise<UblParty | null> {
  if (!customerId) return null;
  const r = await client.query<{
    name_en: string;
    vat_registration_number: string | null;
    cr_number: string | null;
    address: string | null;
    city: string | null;
  }>(`SELECT name_en, vat_registration_number, cr_number, address, city FROM customers WHERE id = $1`, [customerId]);
  const row = r.rows[0];
  if (!row) return null;
  return {
    registrationName: row.name_en,
    vatNumber: row.vat_registration_number,
    crNumber: row.cr_number,
    address: row.address,
    city: row.city,
  };
}

interface LineRow {
  line_number: number;
  item_description: string;
  qty: string;
  unit_price: string;
  net_amount: string;
  vat_amount: string;
  vat_rate: string;
}

function toUblLines(rows: LineRow[]): UblLine[] {
  return rows.map((r) => ({
    lineNumber: r.line_number,
    description: r.item_description,
    quantity: Number(r.qty),
    netAmount: Number(r.net_amount),
    vatAmount: Number(r.vat_amount),
    vatRate: Number(r.vat_rate),
    vatCategory: vatCategoryFromRate(Number(r.vat_rate)),
  }));
}

/**
 * Called once, inside the same transaction as posting, right after a sales
 * invoice flips to 'posted'. Builds the XML with an empty invoiceHash
 * placeholder (a document never hashes itself), hashes that, and freezes
 * both the resulting hash and the chain's previous hash onto the row --
 * every later export of this same invoice reuses these stored values
 * rather than recomputing them, so the chain never shifts under it.
 *
 * Deliberately fails soft: a company that hasn't set its VAT registration
 * number yet (or any other XML-generation problem) must never block the
 * invoice itself from posting -- that's real revenue-recognition business
 * logic and takes priority over an export nicety. The row simply keeps
 * xml_invoice_hash NULL, and the export route reports "no XML export yet"
 * rather than a 500, same as it already does for a draft document.
 */
export async function finalizeSalesInvoiceXmlHash(client: Client, invoiceId: string): Promise<void> {
  try {
    const header = await client.query(
      `SELECT si.company_id, si.store_id, si.customer_id, si.document_number, si.id AS uuid,
              si.invoice_date, si.posted_at, si.zatca_invoice_category, si.net_amount, si.vat_amount, si.gross_amount, c.base_currency
       FROM sales_invoices si JOIN companies c ON c.id = si.company_id
       WHERE si.id = $1`,
      [invoiceId],
    );
    const inv = header.rows[0];
    if (!inv) return;

    const linesResult = await client.query<LineRow>(
      `SELECT line_number, item_description, qty, unit_price, net_amount, vat_amount, vat_rate
       FROM sales_invoice_lines WHERE invoice_id = $1 ORDER BY line_number`,
      [invoiceId],
    );
    const paymentResult = await client.query<{ payment_method: string }>(
      `SELECT payment_method FROM sales_invoice_payments WHERE invoice_id = $1 ORDER BY amount DESC LIMIT 1`,
      [invoiceId],
    );

    const supplier = await loadSupplierParty(client, inv.store_id, inv.company_id);
    const customer = await loadCustomerParty(client, inv.customer_id);
    const { issueDate, issueTime } = toIsoDateParts(new Date(inv.posted_at ?? inv.invoice_date));
    const previousInvoiceHash = await getPreviousInvoiceHash(client, inv.company_id);

    const qrBase64 = buildZatcaQrPayload({
      sellerName: supplier.registrationName,
      vatRegistrationNumber: supplier.vatNumber ?? "",
      timestamp: new Date(inv.posted_at ?? inv.invoice_date).toISOString(),
      invoiceTotal: Number(inv.gross_amount),
      vatTotal: Number(inv.vat_amount),
    });

    const xmlForHashing = buildZatcaInvoiceXml({
      documentNumber: inv.document_number,
      uuid: inv.uuid,
      issueDate,
      issueTime,
      isSimplified: inv.zatca_invoice_category === "simplified",
      currency: inv.base_currency,
      supplier,
      customer,
      lines: toUblLines(linesResult.rows),
      netAmount: Number(inv.net_amount),
      vatAmount: Number(inv.vat_amount),
      grossAmount: Number(inv.gross_amount),
      invoiceHash: "",
      previousInvoiceHash,
      qrBase64,
      paymentMeansCode: PAYMENT_MEANS_CODE[paymentResult.rows[0]?.payment_method ?? "credit"] ?? "1",
    });

    const invoiceHash = computeInvoiceHash(xmlForHashing);
    // This runs immediately after postSalesInvoice already flipped the row
    // to 'posted', so the immutability trigger would otherwise reject it --
    // deliberately bypassed for exactly this one statement (SET LOCAL, so
    // it reverts itself at commit regardless). xml_invoice_hash/
    // xml_previous_invoice_hash are compliance/export metadata computed
    // from fields the trigger already froze (net/vat/gross/lines), not a
    // second chance to edit the transaction itself.
    await client.query(`SET LOCAL app.bypass_immutability = 'true'`);
    await client.query(`UPDATE sales_invoices SET xml_invoice_hash = $1, xml_previous_invoice_hash = $2 WHERE id = $3`, [
      invoiceHash,
      previousInvoiceHash,
      invoiceId,
    ]);
    await client.query(`SET LOCAL app.bypass_immutability = 'false'`);
  } catch {
    // See doc comment: never let an XML-generation problem block posting.
    // Deliberately silent, not logged as an error -- "company hasn't set
    // its VAT number yet" is an expected, common state during setup, not a
    // fault. GET .../xml and the invoice detail route both surface the
    // specific reason on demand when someone actually asks for the export.
  }
}

/** Same fail-soft contract as finalizeSalesInvoiceXmlHash -- see its doc comment. */
export async function finalizeCreditNoteXmlHash(client: Client, creditNoteId: string): Promise<void> {
  try {
    const header = await client.query(
      `SELECT cn.company_id, cn.store_id, cn.customer_id, cn.document_number, cn.id AS uuid,
              cn.credit_note_date, cn.posted_at, cn.zatca_invoice_category, cn.net_amount, cn.vat_amount, cn.gross_amount,
              cn.reason, c.base_currency, si.document_number AS original_document_number
       FROM credit_notes cn
       JOIN companies c ON c.id = cn.company_id
       JOIN sales_invoices si ON si.id = cn.original_invoice_id
       WHERE cn.id = $1`,
      [creditNoteId],
    );
    const cn = header.rows[0];
    if (!cn) return;

    const linesResult = await client.query<LineRow>(
      `SELECT line_number, item_description, qty, unit_price, net_amount, vat_amount, vat_rate
       FROM credit_note_lines WHERE credit_note_id = $1 ORDER BY line_number`,
      [creditNoteId],
    );

    const supplier = await loadSupplierParty(client, cn.store_id, cn.company_id);
    const customer = await loadCustomerParty(client, cn.customer_id);
    const { issueDate, issueTime } = toIsoDateParts(new Date(cn.posted_at ?? cn.credit_note_date));
    const previousInvoiceHash = await getPreviousInvoiceHash(client, cn.company_id);

    const qrBase64 = buildZatcaQrPayload({
      sellerName: supplier.registrationName,
      vatRegistrationNumber: supplier.vatNumber ?? "",
      timestamp: new Date(cn.posted_at ?? cn.credit_note_date).toISOString(),
      invoiceTotal: Number(cn.gross_amount),
      vatTotal: Number(cn.vat_amount),
    });

    const xmlForHashing = buildZatcaCreditNoteXml({
      documentNumber: cn.document_number,
      uuid: cn.uuid,
      issueDate,
      issueTime,
      isSimplified: cn.zatca_invoice_category === "simplified",
      currency: cn.base_currency,
      supplier,
      customer,
      lines: toUblLines(linesResult.rows),
      netAmount: Number(cn.net_amount),
      vatAmount: Number(cn.vat_amount),
      grossAmount: Number(cn.gross_amount),
      invoiceHash: "",
      previousInvoiceHash,
      qrBase64,
      originalInvoiceNumber: cn.original_document_number,
      reason: cn.reason,
    });

    const invoiceHash = computeInvoiceHash(xmlForHashing);
    // See the matching comment in finalizeSalesInvoiceXmlHash.
    await client.query(`SET LOCAL app.bypass_immutability = 'true'`);
    await client.query(`UPDATE credit_notes SET xml_invoice_hash = $1, xml_previous_invoice_hash = $2 WHERE id = $3`, [
      invoiceHash,
      previousInvoiceHash,
      creditNoteId,
    ]);
    await client.query(`SET LOCAL app.bypass_immutability = 'false'`);
  } catch {
    // see doc comment on finalizeSalesInvoiceXmlHash: never let an
    // XML-generation problem block posting, and never log it as an error
  }
}

/** Re-renders the final XML for export/download, reusing the hashes frozen at posting time (see finalizeSalesInvoiceXmlHash). */
export async function renderSalesInvoiceXml(client: Queryable, invoiceId: string, companyId: string): Promise<string | null> {
  const header = await client.query(
    `SELECT si.store_id, si.customer_id, si.document_number, si.id AS uuid, si.invoice_date, si.posted_at,
            si.zatca_invoice_category, si.net_amount, si.vat_amount, si.gross_amount,
            si.xml_invoice_hash, si.xml_previous_invoice_hash, si.document_status, c.base_currency
     FROM sales_invoices si JOIN companies c ON c.id = si.company_id
     WHERE si.id = $1 AND si.company_id = $2`,
    [invoiceId, companyId],
  );
  const inv = header.rows[0];
  if (!inv || inv.document_status !== "posted" || !inv.xml_invoice_hash) return null;

  const linesResult = await client.query<LineRow>(
    `SELECT line_number, item_description, qty, unit_price, net_amount, vat_amount, vat_rate
     FROM sales_invoice_lines WHERE invoice_id = $1 ORDER BY line_number`,
    [invoiceId],
  );
  const paymentResult = await client.query<{ payment_method: string }>(
    `SELECT payment_method FROM sales_invoice_payments WHERE invoice_id = $1 ORDER BY amount DESC LIMIT 1`,
    [invoiceId],
  );

  const supplier = await loadSupplierParty(client, inv.store_id, companyId);
  const customer = await loadCustomerParty(client, inv.customer_id);
  const { issueDate, issueTime } = toIsoDateParts(new Date(inv.posted_at ?? inv.invoice_date));

  const qrBase64 = buildZatcaQrPayload({
    sellerName: supplier.registrationName,
    vatRegistrationNumber: supplier.vatNumber ?? "",
    timestamp: new Date(inv.posted_at ?? inv.invoice_date).toISOString(),
    invoiceTotal: Number(inv.gross_amount),
    vatTotal: Number(inv.vat_amount),
  });

  return buildZatcaInvoiceXml({
    documentNumber: inv.document_number,
    uuid: inv.uuid,
    issueDate,
    issueTime,
    isSimplified: inv.zatca_invoice_category === "simplified",
    currency: inv.base_currency,
    supplier,
    customer,
    lines: toUblLines(linesResult.rows),
    netAmount: Number(inv.net_amount),
    vatAmount: Number(inv.vat_amount),
    grossAmount: Number(inv.gross_amount),
    invoiceHash: inv.xml_invoice_hash,
    previousInvoiceHash: inv.xml_previous_invoice_hash,
    qrBase64,
    paymentMeansCode: PAYMENT_MEANS_CODE[paymentResult.rows[0]?.payment_method ?? "credit"] ?? "1",
  });
}

export async function renderCreditNoteXml(client: Queryable, creditNoteId: string, companyId: string): Promise<string | null> {
  const header = await client.query(
    `SELECT cn.store_id, cn.customer_id, cn.document_number, cn.id AS uuid, cn.credit_note_date, cn.posted_at,
            cn.zatca_invoice_category, cn.net_amount, cn.vat_amount, cn.gross_amount, cn.reason,
            cn.xml_invoice_hash, cn.xml_previous_invoice_hash, cn.document_status,
            c.base_currency, si.document_number AS original_document_number
     FROM credit_notes cn
     JOIN companies c ON c.id = cn.company_id
     JOIN sales_invoices si ON si.id = cn.original_invoice_id
     WHERE cn.id = $1 AND cn.company_id = $2`,
    [creditNoteId, companyId],
  );
  const cn = header.rows[0];
  if (!cn || cn.document_status !== "posted" || !cn.xml_invoice_hash) return null;

  const linesResult = await client.query<LineRow>(
    `SELECT line_number, item_description, qty, unit_price, net_amount, vat_amount, vat_rate
     FROM credit_note_lines WHERE credit_note_id = $1 ORDER BY line_number`,
    [creditNoteId],
  );

  const supplier = await loadSupplierParty(client, cn.store_id, companyId);
  const customer = await loadCustomerParty(client, cn.customer_id);
  const { issueDate, issueTime } = toIsoDateParts(new Date(cn.posted_at ?? cn.credit_note_date));

  const qrBase64 = buildZatcaQrPayload({
    sellerName: supplier.registrationName,
    vatRegistrationNumber: supplier.vatNumber ?? "",
    timestamp: new Date(cn.posted_at ?? cn.credit_note_date).toISOString(),
    invoiceTotal: Number(cn.gross_amount),
    vatTotal: Number(cn.vat_amount),
  });

  return buildZatcaCreditNoteXml({
    documentNumber: cn.document_number,
    uuid: cn.uuid,
    issueDate,
    issueTime,
    isSimplified: cn.zatca_invoice_category === "simplified",
    currency: cn.base_currency,
    supplier,
    customer,
    lines: toUblLines(linesResult.rows),
    netAmount: Number(cn.net_amount),
    vatAmount: Number(cn.vat_amount),
    grossAmount: Number(cn.gross_amount),
    invoiceHash: cn.xml_invoice_hash,
    previousInvoiceHash: cn.xml_previous_invoice_hash,
    qrBase64,
    originalInvoiceNumber: cn.original_document_number,
    reason: cn.reason,
  });
}
