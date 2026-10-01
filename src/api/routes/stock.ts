import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

const querySchema = z.object({
  storeId: z.string().uuid(),
});

export async function stockRoutes(app: FastifyInstance): Promise<void> {
  // A snapshot, explicitly labeled as such — this is the "last known,
  // clearly marked as such" stock view an offline POS client would cache.
  app.get("/stock-balances", { preHandler: app.authenticate }, async (request) => {
    const query = querySchema.parse(request.query);

    const store = await pool.query(`SELECT company_id FROM stores WHERE id = $1`, [query.storeId]);
    if (store.rows.length === 0 || store.rows[0]!.company_id !== request.companyId) {
      return { asOf: new Date().toISOString(), balances: [] };
    }

    const result = await pool.query(
      `SELECT item_variant_id, qty_on_hand, avg_unit_cost, last_movement_at
       FROM stock_balances WHERE store_id = $1`,
      [query.storeId],
    );

    return { asOf: new Date().toISOString(), balances: result.rows };
  });

  // Availability matrix: every variant's qty_on_hand across every store in
  // one call, for the Stock screen's item x store grid -- avoids N
  // requests (one per store) or forcing the "which store?" dropdown just
  // to answer "where do we have this?".
  app.get("/stock-balances/matrix", { preHandler: app.authenticate }, async (request) => {
    const stores = await pool.query<{ id: string; name_en: string; name_ar: string }>(
      `SELECT id, name_en, name_ar FROM stores WHERE company_id = $1 AND is_active = true ORDER BY name_en`,
      [request.companyId],
    );

    const balances = await pool.query<{ item_variant_id: string; store_id: string; qty_on_hand: string }>(
      `SELECT sb.item_variant_id, sb.store_id, sb.qty_on_hand
       FROM stock_balances sb
       JOIN stores s ON s.id = sb.store_id
       WHERE s.company_id = $1 AND sb.qty_on_hand <> 0`,
      [request.companyId],
    );

    return { asOf: new Date().toISOString(), stores: stores.rows, balances: balances.rows };
  });
}
