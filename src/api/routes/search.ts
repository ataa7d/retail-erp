import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";

export interface SearchResult {
  type: "customer" | "supplier" | "item" | "sales_invoice" | "purchase_order";
  id: string;
  label: string;
  detail: string;
  link: string;
}

/**
 * The header search box (Layout.tsx) was pure decoration -- no onChange,
 * no results. This is a quick cross-entity jump, not a full-text search
 * engine: a handful of ILIKE lookups across the things people actually
 * look up by name or number, each capped small so the dropdown stays fast
 * and scannable.
 */
export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string } }>("/search", { preHandler: app.authenticate }, async (request) => {
    const q = (request.query.q ?? "").trim();
    if (q.length < 2) return { results: [] };
    const like = `%${q}%`;
    const results: SearchResult[] = [];

    const customers = await pool.query<{ id: string; name_en: string; name_ar: string }>(
      `SELECT id, name_en, name_ar FROM customers WHERE company_id = $1 AND (name_en ILIKE $2 OR name_ar ILIKE $2) ORDER BY name_en LIMIT 5`,
      [request.companyId, like],
    );
    for (const row of customers.rows) {
      results.push({ type: "customer", id: row.id, label: row.name_en, detail: "Customer", link: "/accounting" });
    }

    const suppliers = await pool.query<{ id: string; name_en: string; name_ar: string }>(
      `SELECT id, name_en, name_ar FROM suppliers WHERE company_id = $1 AND (name_en ILIKE $2 OR name_ar ILIKE $2) ORDER BY name_en LIMIT 5`,
      [request.companyId, like],
    );
    for (const row of suppliers.rows) {
      results.push({ type: "supplier", id: row.id, label: row.name_en, detail: "Supplier", link: "/purchasing" });
    }

    const items = await pool.query<{ id: string; item_code: string; name_en: string }>(
      `SELECT id, item_code, name_en FROM items WHERE company_id = $1 AND (name_en ILIKE $2 OR item_code ILIKE $2) ORDER BY name_en LIMIT 5`,
      [request.companyId, like],
    );
    for (const row of items.rows) {
      results.push({ type: "item", id: row.id, label: row.name_en, detail: `Item ${row.item_code}`, link: "/inventory" });
    }

    const invoices = await pool.query<{ id: string; document_number: string }>(
      `SELECT id, document_number FROM sales_invoices WHERE company_id = $1 AND document_number ILIKE $2 ORDER BY document_number LIMIT 5`,
      [request.companyId, like],
    );
    for (const row of invoices.rows) {
      results.push({ type: "sales_invoice", id: row.id, label: row.document_number, detail: "Sales Invoice", link: `/sales/invoices/${row.id}` });
    }

    const pos = await pool.query<{ id: string; document_number: string }>(
      `SELECT id, document_number FROM purchase_orders WHERE company_id = $1 AND document_number ILIKE $2 ORDER BY document_number LIMIT 5`,
      [request.companyId, like],
    );
    for (const row of pos.rows) {
      results.push({ type: "purchase_order", id: row.id, label: row.document_number, detail: "Purchase Order", link: `/purchasing/orders/${row.id}` });
    }

    return { results: results.slice(0, 20) };
  });
}
