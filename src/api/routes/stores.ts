import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { NotFoundError } from "../errors.js";

const defaultPriceListSchema = z.object({
  priceListId: z.string().uuid().nullable(),
});

export async function storeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/stores", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, branch_id, store_code, name_en, name_ar, store_type, city, default_price_list_id
       FROM stores WHERE company_id = $1 ORDER BY store_code`,
      [request.companyId],
    );
    return result.rows;
  });

  app.post<{ Params: { id: string } }>(
    "/stores/:id/default-price-list",
    { preHandler: [app.authenticate, app.requirePermission("sales.pos_device.manage")] },
    async (request) => {
      const body = defaultPriceListSchema.parse(request.body);
      await withTransaction(async (client) => {
        const store = await client.query(`SELECT id FROM stores WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (store.rows.length === 0) throw new NotFoundError("store not found");
        if (body.priceListId) {
          const priceList = await client.query(`SELECT id FROM price_lists WHERE id = $1 AND company_id = $2`, [
            body.priceListId,
            request.companyId,
          ]);
          if (priceList.rows.length === 0) throw new NotFoundError("price list not found");
        }
        await client.query(`UPDATE stores SET default_price_list_id = $1 WHERE id = $2`, [body.priceListId, request.params.id]);
      }, request.authUser.id);
      return { id: request.params.id, defaultPriceListId: body.priceListId };
    },
  );
}
