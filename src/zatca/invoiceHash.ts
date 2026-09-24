import { createHash } from "node:crypto";
import type { Client } from "pg";

/**
 * ZATCA requires every e-invoice XML to carry the hash of the invoice
 * immediately before it in the company's submission sequence (PIH -
 * Previous Invoice Hash), chaining the whole history together so a gap or
 * edit is detectable. Per ZATCA's spec, the very first invoice in a
 * company's chain uses a fixed genesis value: the Base64 encoding of the
 * single character "0" -- not a hash of anything, just that literal.
 */
export const ZATCA_GENESIS_PREVIOUS_HASH = Buffer.from("0", "utf8").toString("base64");

/** SHA-256 of the given XML content, Base64-encoded -- this becomes that document's own xml_invoice_hash. */
export function computeInvoiceHash(canonicalXml: string): string {
  return createHash("sha256").update(canonicalXml, "utf8").digest("base64");
}

/**
 * The hash to chain from: whichever posted sales invoice or credit note in
 * this company was posted most recently (the two document types share one
 * chain, same as ZATCA's per-EGS-unit sequence spanning invoice and credit
 * note submissions together). Falls back to the genesis value for a
 * company's very first posted document.
 */
export async function getPreviousInvoiceHash(client: Client, companyId: string): Promise<string> {
  const r = await client.query<{ xml_invoice_hash: string }>(
    `SELECT xml_invoice_hash, posted_at FROM (
       SELECT xml_invoice_hash, posted_at FROM sales_invoices
         WHERE company_id = $1 AND document_status = 'posted' AND xml_invoice_hash IS NOT NULL
       UNION ALL
       SELECT xml_invoice_hash, posted_at FROM credit_notes
         WHERE company_id = $1 AND document_status = 'posted' AND xml_invoice_hash IS NOT NULL
     ) chain
     ORDER BY posted_at DESC, xml_invoice_hash DESC
     LIMIT 1`,
    [companyId],
  );
  return r.rows[0]?.xml_invoice_hash ?? ZATCA_GENESIS_PREVIOUS_HASH;
}
