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
}
