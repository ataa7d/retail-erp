import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";

export async function priceListRoutes(app: FastifyInstance): Promise<void> {
  app.get("/price-lists", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, code, name_en, name_ar, currency, price_includes_vat, is_default, is_active
       FROM price_lists WHERE company_id = $1 ORDER BY code`,
      [request.companyId],
    );
    return result.rows;
  });

  app.get<{ Params: { id: string } }>(
    "/price-lists/:id/items",
    { preHandler: app.authenticate },
    async (request) => {
      const result = await pool.query(
        `SELECT pli.item_variant_id, pli.price
         FROM price_list_items pli
         JOIN price_lists pl ON pl.id = pli.price_list_id
         WHERE pl.id = $1 AND pl.company_id = $2 AND pli.is_active = true`,
        [request.params.id, request.companyId],
      );
      return result.rows;
    },
  );
}
