import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { NotFoundError } from "../errors.js";

// Read-only for now — purchasing.po.create exists as a permission and
// src/purchasing/purchasingService.ts has the full PO -> GR -> invoice
// chain, but write routes for it were never wired to HTTP (only sales was
// built out as the "representative pattern" in the Phase-8-prerequisite
// API work). These list/detail routes are enough for the frontend to show
// purchasing data; POST routes are a follow-up.
export async function purchasingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/purchase-orders", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT po.id, po.document_number, po.order_date, po.expected_date, po.document_status,
              po.net_amount, po.vat_amount, po.gross_amount,
              s.name_en AS supplier_name_en, s.name_ar AS supplier_name_ar
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.company_id = $1
       ORDER BY po.order_date DESC`,
      [request.companyId],
    );
    return result.rows;
  });

  app.get<{ Params: { id: string } }>("/purchase-orders/:id", { preHandler: app.authenticate }, async (request) => {
    const header = await pool.query(
      `SELECT po.*, s.name_en AS supplier_name_en, s.name_ar AS supplier_name_ar
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.id = $1 AND po.company_id = $2`,
      [request.params.id, request.companyId],
    );
    if (header.rows.length === 0) throw new NotFoundError("purchase order not found");

    const lines = await pool.query(
      `SELECT pol.*, iv.variant_code, i.name_en AS item_name_en, i.name_ar AS item_name_ar
       FROM purchase_order_lines pol
       JOIN item_variants iv ON iv.id = pol.item_variant_id
       JOIN items i ON i.id = iv.item_id
       WHERE pol.purchase_order_id = $1
       ORDER BY pol.line_number`,
      [request.params.id],
    );
    return { ...header.rows[0], lines: lines.rows };
  });

  app.get("/suppliers", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, supplier_code, name_en, name_ar, city, country, payment_terms_days, lead_time_days, is_active
       FROM suppliers WHERE company_id = $1 ORDER BY name_en`,
      [request.companyId],
    );
    return result.rows;
  });
}
