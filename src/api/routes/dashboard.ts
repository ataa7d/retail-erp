import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";

/**
 * One aggregate endpoint for the home page's KPI tiles instead of a pile of
 * separate list fetches the frontend used to sum client-side. Every figure
 * here is scoped to the caller's company (and store_id-scoped role, same as
 * everywhere else) and only counts posted documents where "posted" is the
 * meaningful state (sales totals, AR/AP) -- draft documents never show up
 * in a KPI meant to represent actual business activity.
 */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/dashboard/summary", { preHandler: app.authenticate }, async (request) => {
    const companyId = request.companyId;

    const [todaySales, mtdSales, inventoryValue, arTotal, apTotal, lowStock] = await Promise.all([
      pool.query<{ total: string; count: string }>(
        `SELECT COALESCE(SUM(gross_amount), 0) AS total, COUNT(*) AS count
         FROM sales_invoices
         WHERE company_id = $1 AND document_status = 'posted' AND invoice_date = CURRENT_DATE`,
        [companyId],
      ),
      pool.query<{ total: string; count: string }>(
        `SELECT COALESCE(SUM(gross_amount), 0) AS total, COUNT(*) AS count
         FROM sales_invoices
         WHERE company_id = $1 AND document_status = 'posted'
           AND invoice_date >= date_trunc('month', CURRENT_DATE)::date AND invoice_date <= CURRENT_DATE`,
        [companyId],
      ),
      pool.query<{ total: string }>(`SELECT COALESCE(SUM(total_value), 0) AS total FROM stock_balances WHERE company_id = $1`, [
        companyId,
      ]),
      pool.query<{ total: string }>(
        `SELECT COALESCE(SUM(open_amount), 0) AS total FROM ar_ageing WHERE company_id = $1`,
        [companyId],
      ),
      pool.query<{ total: string }>(
        `SELECT COALESCE(SUM(open_amount), 0) AS total FROM ap_ageing WHERE company_id = $1`,
        [companyId],
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM (
           SELECT iv.id
           FROM item_variants iv
           LEFT JOIN stock_balances sb ON sb.item_variant_id = iv.id AND sb.company_id = iv.company_id
           WHERE iv.company_id = $1 AND iv.is_active = true AND iv.reorder_point > 0
           GROUP BY iv.id, iv.reorder_point
           HAVING COALESCE(SUM(sb.qty_on_hand), 0) < iv.reorder_point
         ) low`,
        [companyId],
      ),
    ]);

    return {
      todaySales: { total: Number(todaySales.rows[0]!.total), count: Number(todaySales.rows[0]!.count) },
      monthToDateSales: { total: Number(mtdSales.rows[0]!.total), count: Number(mtdSales.rows[0]!.count) },
      inventoryValue: Number(inventoryValue.rows[0]!.total),
      arOutstanding: Number(arTotal.rows[0]!.total),
      apOutstanding: Number(apTotal.rows[0]!.total),
      lowStockCount: Number(lowStock.rows[0]!.count),
    };
  });

  app.get("/dashboard/low-stock", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT iv.id AS item_variant_id, iv.variant_code, iv.color, iv.size, iv.reorder_point,
              i.name_en AS item_name_en, i.name_ar AS item_name_ar,
              COALESCE(SUM(sb.qty_on_hand), 0) AS qty_on_hand
       FROM item_variants iv
       JOIN items i ON i.id = iv.item_id
       LEFT JOIN stock_balances sb ON sb.item_variant_id = iv.id AND sb.company_id = iv.company_id
       WHERE iv.company_id = $1 AND iv.is_active = true AND iv.reorder_point > 0
       GROUP BY iv.id, iv.reorder_point, i.name_en, i.name_ar
       HAVING COALESCE(SUM(sb.qty_on_hand), 0) < iv.reorder_point
       ORDER BY i.name_en`,
      [request.companyId],
    );
    return result.rows;
  });
}
