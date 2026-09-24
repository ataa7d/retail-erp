import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { NotFoundError } from "../errors.js";

const createSchema = z.object({
  code: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  currency: z.string().min(1).default("SAR"),
  priceIncludesVat: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

const setPriceSchema = z.object({
  itemVariantId: z.string().uuid(),
  price: z.number().nonnegative(),
});

export async function priceListRoutes(app: FastifyInstance): Promise<void> {
  app.get("/price-lists", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, code, name_en, name_ar, currency, price_includes_vat, is_default, is_active
       FROM price_lists WHERE company_id = $1 ORDER BY code`,
      [request.companyId],
    );
    return result.rows;
  });

  app.post(
    "/price-lists",
    { preHandler: [app.authenticate, app.requirePermission("sales.price_list.manage")] },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      const priceListId = await withTransaction(async (client) => {
        // Only one price list can be the default per company (partial unique
        // index on price_lists) -- clear the current default first so making
        // a new one default doesn't just hit a 409 from that constraint.
        if (body.isDefault) {
          await client.query(`UPDATE price_lists SET is_default = false WHERE company_id = $1 AND is_default = true`, [
            request.companyId,
          ]);
        }
        const result = await client.query<{ id: string }>(
          `INSERT INTO price_lists (company_id, code, name_en, name_ar, currency, price_includes_vat, is_default)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [request.companyId, body.code, body.nameEn, body.nameAr, body.currency, body.priceIncludesVat, body.isDefault],
        );
        return result.rows[0]!.id;
      }, request.authUser.id);
      reply.status(201);
      return { id: priceListId };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/price-lists/:id/deactivate",
    { preHandler: [app.authenticate, app.requirePermission("sales.price_list.manage")] },
    async (request) => {
      const existing = await pool.query(`SELECT id FROM price_lists WHERE id = $1 AND company_id = $2`, [
        request.params.id,
        request.companyId,
      ]);
      if (existing.rows.length === 0) throw new NotFoundError("price list not found");
      await pool.query(`UPDATE price_lists SET is_active = false WHERE id = $1`, [request.params.id]);
      return { id: request.params.id, status: "inactive" };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/price-lists/:id/reactivate",
    { preHandler: [app.authenticate, app.requirePermission("sales.price_list.manage")] },
    async (request) => {
      const existing = await pool.query(`SELECT id FROM price_lists WHERE id = $1 AND company_id = $2`, [
        request.params.id,
        request.companyId,
      ]);
      if (existing.rows.length === 0) throw new NotFoundError("price list not found");
      await pool.query(`UPDATE price_lists SET is_active = true WHERE id = $1`, [request.params.id]);
      return { id: request.params.id, status: "active" };
    },
  );

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

  // Upsert one variant's price on the list -- a price list is edited line by
  // line from the UI (search a variant, type a price), not as a bulk
  // replace, so this sets a single row rather than requiring the whole list.
  app.post<{ Params: { id: string } }>(
    "/price-lists/:id/items",
    { preHandler: [app.authenticate, app.requirePermission("sales.price_list.manage")] },
    async (request, reply) => {
      const body = setPriceSchema.parse(request.body);
      await withTransaction(async (client) => {
        const list = await client.query(`SELECT id FROM price_lists WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (list.rows.length === 0) throw new NotFoundError("price list not found");

        await client.query(
          `INSERT INTO price_list_items (price_list_id, item_variant_id, price, is_active)
           VALUES ($1, $2, $3, true)
           ON CONFLICT (price_list_id, item_variant_id)
             DO UPDATE SET price = EXCLUDED.price, is_active = true`,
          [request.params.id, body.itemVariantId, body.price],
        );
      }, request.authUser.id);
      reply.status(200);
      return { itemVariantId: body.itemVariantId, price: body.price };
    },
  );

  app.post<{ Params: { id: string; variantId: string } }>(
    "/price-lists/:id/items/:variantId/remove",
    { preHandler: [app.authenticate, app.requirePermission("sales.price_list.manage")] },
    async (request) => {
      await withTransaction(async (client) => {
        const list = await client.query(`SELECT id FROM price_lists WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (list.rows.length === 0) throw new NotFoundError("price list not found");
        await client.query(
          `UPDATE price_list_items SET is_active = false WHERE price_list_id = $1 AND item_variant_id = $2`,
          [request.params.id, request.params.variantId],
        );
      }, request.authUser.id);
      return { itemVariantId: request.params.variantId, status: "removed" };
    },
  );
}
