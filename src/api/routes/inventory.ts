import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { transferStock, createStocktake, recordStocktakeCount, postStocktake } from "../../inventory/inventoryService.js";
import { NotFoundError } from "../errors.js";

const transferSchema = z.object({
  sourceStoreId: z.string().uuid(),
  destStoreId: z.string().uuid(),
  itemVariantId: z.string().uuid(),
  qty: z.number().positive(),
  reasonCode: z.string().optional(),
});

const stocktakeCreateSchema = z.object({
  storeId: z.string().uuid(),
  stocktakeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fiscalPeriodId: z.string().uuid(),
  itemVariantIds: z.array(z.string().uuid()).min(1),
});

const countSchema = z.object({
  countedQty: z.number().nonnegative(),
});

export async function inventoryRoutes(app: FastifyInstance): Promise<void> {
  // ---- Transfers ----
  // No draft/post distinction — a transfer is two linked stock_movements
  // rows, immediately effective once recorded (same as the rest of the
  // append-only ledger), so "create" and "post" are the same call.

  app.post(
    "/stock-transfers",
    { preHandler: [app.authenticate, app.requirePermission("inventory.transfer.post")] },
    async (request, reply) => {
      const body = transferSchema.parse(request.body);
      const result = await withTransaction(
        (client) =>
          transferStock(client, {
            companyId: request.companyId,
            sourceStoreId: body.sourceStoreId,
            destStoreId: body.destStoreId,
            itemVariantId: body.itemVariantId,
            qty: body.qty,
            reasonCode: body.reasonCode,
            createdBy: request.authUser.id,
          }),
        request.authUser.id,
      );
      reply.status(201);
      return result;
    },
  );

  app.get("/stock-transfers", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT
         mo.id, mo.movement_at, mo.qty, mo.unit_cost, mo.total_cost, mo.reason_code,
         so.store_code AS source_store_code, so.name_en AS source_store_name,
         sd.store_code AS dest_store_code, sd.name_en AS dest_store_name,
         iv.variant_code, i.name_en AS item_name_en, i.name_ar AS item_name_ar
       FROM stock_movements mo
       JOIN stock_movements mi ON mi.linked_movement_id = mo.id
       JOIN stores so ON so.id = mo.store_id
       JOIN stores sd ON sd.id = mi.store_id
       JOIN item_variants iv ON iv.id = mo.item_variant_id
       JOIN items i ON i.id = iv.item_id
       WHERE mo.company_id = $1 AND mo.movement_type = 'transfer_out'
       ORDER BY mo.movement_at DESC
       LIMIT 200`,
      [request.companyId],
    );
    return result.rows;
  });

  // ---- Stocktakes (the GL-posting adjustment mechanism: count a store's
  // stock, post the variance as stock_movements plus a journal against
  // 5110 Inventory Adjustments) ----

  app.post(
    "/stocktakes",
    { preHandler: [app.authenticate, app.requirePermission("inventory.adjustment.post")] },
    async (request, reply) => {
      const body = stocktakeCreateSchema.parse(request.body);
      const id = await withTransaction(
        (client) =>
          createStocktake(client, {
            companyId: request.companyId,
            storeId: body.storeId,
            stocktakeDate: body.stocktakeDate,
            fiscalPeriodId: body.fiscalPeriodId,
            itemVariantIds: body.itemVariantIds,
            createdBy: request.authUser.id,
          }),
        request.authUser.id,
      );
      reply.status(201);
      return { id };
    },
  );

  app.get("/stocktakes", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT st.id, st.document_number, st.stocktake_date, st.document_status,
              s.name_en AS store_name_en,
              (SELECT COUNT(*) FROM stocktake_lines WHERE stocktake_id = st.id) AS line_count,
              (SELECT COUNT(*) FROM stocktake_lines WHERE stocktake_id = st.id AND counted_qty IS NULL) AS uncounted_count
       FROM stocktakes st
       JOIN stores s ON s.id = st.store_id
       WHERE st.company_id = $1
       ORDER BY st.stocktake_date DESC, st.created_at DESC
       LIMIT 200`,
      [request.companyId],
    );
    return result.rows;
  });

  app.get<{ Params: { id: string } }>("/stocktakes/:id", { preHandler: app.authenticate }, async (request) => {
    const header = await pool.query(
      `SELECT st.*, s.name_en AS store_name_en FROM stocktakes st JOIN stores s ON s.id = st.store_id
       WHERE st.id = $1 AND st.company_id = $2`,
      [request.params.id, request.companyId],
    );
    if (header.rows.length === 0) throw new NotFoundError("stocktake not found");

    const lines = await pool.query(
      `SELECT stl.*, iv.variant_code, i.name_en AS item_name_en, i.name_ar AS item_name_ar
       FROM stocktake_lines stl
       JOIN item_variants iv ON iv.id = stl.item_variant_id
       JOIN items i ON i.id = iv.item_id
       WHERE stl.stocktake_id = $1
       ORDER BY i.name_en`,
      [request.params.id],
    );
    return { ...header.rows[0], lines: lines.rows };
  });

  app.post<{ Params: { id: string; lineId: string } }>(
    "/stocktakes/:id/lines/:lineId/count",
    { preHandler: [app.authenticate, app.requirePermission("inventory.adjustment.post")] },
    async (request) => {
      const body = countSchema.parse(request.body);
      await withTransaction(async (client) => {
        const existing = await client.query(
          `SELECT stl.id FROM stocktake_lines stl JOIN stocktakes st ON st.id = stl.stocktake_id
           WHERE stl.id = $1 AND stl.stocktake_id = $2 AND st.company_id = $3`,
          [request.params.lineId, request.params.id, request.companyId],
        );
        if (existing.rows.length === 0) throw new NotFoundError("stocktake line not found");
        await recordStocktakeCount(client, request.params.lineId, body.countedQty);
      }, request.authUser.id);
      return { id: request.params.lineId, countedQty: body.countedQty };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/stocktakes/:id/post",
    { preHandler: [app.authenticate, app.requirePermission("inventory.adjustment.post")] },
    async (request) => {
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM stocktakes WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("stocktake not found");
        await postStocktake(client, request.params.id, request.authUser.id);
      }, request.authUser.id);
      return { id: request.params.id, status: "posted" };
    },
  );
}
