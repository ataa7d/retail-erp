/**
 * One-off maintenance script: computes the ZATCA XML invoice-hash chain
 * (see src/zatca/invoiceHash.ts) for sales invoices and credit notes that
 * were posted before migration 0056 added xml_invoice_hash -- without this,
 * those older documents would show "no XML export yet" forever, since the
 * posting-time hook that normally does this only runs going forward.
 *
 * Must run strictly in posted_at order, per company, sales invoices and
 * credit notes interleaved on one chain -- that's the whole point of a
 * hash chain, so this cannot be parallelized or batched out of order.
 */
import "dotenv/config";
import { Client } from "pg";
import { finalizeSalesInvoiceXmlHash, finalizeCreditNoteXmlHash } from "../src/zatca/invoiceXmlService.js";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const companies = await client.query<{ id: string; name_en: string }>(`SELECT id, name_en FROM companies ORDER BY name_en`);

    for (const company of companies.rows) {
      const docs = await client.query<{ id: string; kind: "sales_invoice" | "credit_note"; posted_at: string }>(
        `SELECT id, 'sales_invoice' AS kind, posted_at FROM sales_invoices
           WHERE company_id = $1 AND document_status = 'posted' AND xml_invoice_hash IS NULL
         UNION ALL
         SELECT id, 'credit_note' AS kind, posted_at FROM credit_notes
           WHERE company_id = $1 AND document_status = 'posted' AND xml_invoice_hash IS NULL
         ORDER BY posted_at ASC`,
        [company.id],
      );

      if (docs.rows.length === 0) continue;
      console.log(`${company.name_en}: backfilling ${docs.rows.length} document(s)...`);

      for (const doc of docs.rows) {
        await client.query("BEGIN");
        try {
          if (doc.kind === "sales_invoice") {
            await finalizeSalesInvoiceXmlHash(client, doc.id);
          } else {
            await finalizeCreditNoteXmlHash(client, doc.id);
          }
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      }
    }

    console.log("Backfill complete.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
