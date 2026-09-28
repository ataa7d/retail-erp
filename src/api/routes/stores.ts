import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { NotFoundError } from "../errors.js";

const defaultPriceListSchema = z.object({
  priceListId: z.string().uuid().nullable(),
});

const createStoreSchema = z.object({
  branchId: z.string().uuid(),
  storeCode: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  storeType: z.enum(["retail", "warehouse", "kiosk", "online"]).default("retail"),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
});

const updateStoreSchema = createStoreSchema.omit({ storeCode: true });

export async function storeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/stores", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, branch_id, store_code, name_en, name_ar, store_type, address, city, default_price_list_id, is_active
       FROM stores WHERE company_id = $1 ORDER BY store_code`,
      [request.companyId],
    );
    return result.rows;
  });

  app.post(
    "/stores",
    { preHandler: [app.authenticate, app.requirePermission("admin.companies.manage")] },
    async (request, reply) => {
      const body = createStoreSchema.parse(request.body);
      const storeId = await withTransaction(async (client) => {
        const branch = await client.query(`SELECT id FROM branches WHERE id = $1 AND company_id = $2`, [
          body.branchId,
          request.companyId,
        ]);
        if (branch.rows.length === 0) throw new NotFoundError("branch not found");
        const result = await client.query<{ id: string }>(
          `INSERT INTO stores (company_id, branch_id, store_code, name_en, name_ar, store_type, address, city)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [request.companyId, body.branchId, body.storeCode, body.nameEn, body.nameAr, body.storeType, body.address ?? null, body.city ?? null],
        );
        return result.rows[0]!.id;
      }, request.authUser.id);
      reply.status(201);
      return { id: storeId };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/stores/:id",
    { preHandler: [app.authenticate, app.requirePermission("admin.companies.manage")] },
    async (request) => {
      const body = updateStoreSchema.parse(request.body);
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM stores WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("store not found");
        const branch = await client.query(`SELECT id FROM branches WHERE id = $1 AND company_id = $2`, [
          body.branchId,
          request.companyId,
        ]);
        if (branch.rows.length === 0) throw new NotFoundError("branch not found");
        await client.query(
          `UPDATE stores SET branch_id = $1, name_en = $2, name_ar = $3, store_type = $4, address = $5, city = $6 WHERE id = $7`,
          [body.branchId, body.nameEn, body.nameAr, body.storeType, body.address ?? null, body.city ?? null, request.params.id],
        );
      }, request.authUser.id);
      return { id: request.params.id };
    },
  );

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
