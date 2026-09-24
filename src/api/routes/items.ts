import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { NotFoundError } from "../errors.js";

const listQuerySchema = z.object({
  updatedSince: z.string().datetime().optional(),
});

const createSchema = z.object({
  itemCode: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  baseUnitOfMeasureId: z.string().uuid(),
  // Minimal single-variant creation, not the full color/size matrix a real
  // "new item" wizard would offer -- variantCode is required, color/size
  // optional, matching what item_variants actually requires (UNIQUE on
  // (item_id, color, size)). Additional variants are added afterward via
  // POST /items/:id/variants.
  variantCode: z.string().min(1),
  color: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
});

const addVariantSchema = z.object({
  variantCode: z.string().min(1),
  color: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
});

const addBarcodeSchema = z.object({
  barcode: z.string().min(1),
  unitOfMeasureId: z.string().uuid(),
  isPrimary: z.boolean().default(true),
});

export async function itemRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/items",
    { preHandler: [app.authenticate, app.requirePermission("inventory.items.manage")] },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      const itemId = await withTransaction(async (client) => {
        const item = await client.query<{ id: string }>(
          `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, $2, $3, $4) RETURNING id`,
          [request.companyId, body.itemCode, body.nameEn, body.nameAr],
        );
        const newItemId = item.rows[0]!.id;

        // Every item needs at least a base unit registered before any
        // barcode can be added to its variants (item_barcodes.unit_of_measure_id
        // must be one of item_units for this item -- see migration 0014).
        await client.query(
          `INSERT INTO item_units (item_id, unit_of_measure_id, conversion_factor, is_base) VALUES ($1, $2, 1, true)`,
          [newItemId, body.baseUnitOfMeasureId],
        );

        await client.query(
          `INSERT INTO item_variants (company_id, item_id, variant_code, color, size)
           VALUES ($1, $2, $3, $4, $5)`,
          [request.companyId, newItemId, body.variantCode, body.color ?? null, body.size ?? null],
        );
        return newItemId;
      }, request.authUser.id);
      reply.status(201);
      return { id: itemId };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/items/:id/variants",
    { preHandler: [app.authenticate, app.requirePermission("inventory.items.manage")] },
    async (request, reply) => {
      const body = addVariantSchema.parse(request.body);
      const variantId = await withTransaction(async (client) => {
        const item = await client.query(`SELECT id FROM items WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (item.rows.length === 0) throw new NotFoundError("item not found");

        const variant = await client.query<{ id: string }>(
          `INSERT INTO item_variants (company_id, item_id, variant_code, color, size)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [request.companyId, request.params.id, body.variantCode, body.color ?? null, body.size ?? null],
        );
        return variant.rows[0]!.id;
      }, request.authUser.id);
      reply.status(201);
      return { id: variantId };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/item-variants/:id/barcodes",
    { preHandler: [app.authenticate, app.requirePermission("inventory.items.manage")] },
    async (request, reply) => {
      const body = addBarcodeSchema.parse(request.body);
      const barcodeId = await withTransaction(async (client) => {
        const variant = await client.query(`SELECT id FROM item_variants WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (variant.rows.length === 0) throw new NotFoundError("item variant not found");

        const barcode = await client.query<{ id: string }>(
          `INSERT INTO item_barcodes (company_id, item_variant_id, unit_of_measure_id, barcode, is_primary)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [request.companyId, request.params.id, body.unitOfMeasureId, body.barcode, body.isPrimary],
        );
        return barcode.rows[0]!.id;
      }, request.authUser.id);
      reply.status(201);
      return { id: barcodeId };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/item-variants/:id/deactivate",
    { preHandler: [app.authenticate, app.requirePermission("inventory.items.manage")] },
    async (request) => {
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM item_variants WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("item variant not found");
        await client.query(`UPDATE item_variants SET is_active = false WHERE id = $1`, [request.params.id]);
      }, request.authUser.id);
      return { id: request.params.id, status: "inactive" };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/item-variants/:id/reactivate",
    { preHandler: [app.authenticate, app.requirePermission("inventory.items.manage")] },
    async (request) => {
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM item_variants WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("item variant not found");
        await client.query(`UPDATE item_variants SET is_active = true WHERE id = $1`, [request.params.id]);
      }, request.authUser.id);
      return { id: request.params.id, status: "active" };
    },
  );

  // Master data syncs one way, down — updatedSince lets a client (POS,
  // admin UI) pull only what changed since its last sync.
  app.get("/items", { preHandler: app.authenticate }, async (request) => {
    const query = listQuerySchema.parse(request.query);

    const items = await pool.query(
      `SELECT id, item_code, name_en, name_ar, brand_id, category_id, season_id, item_year,
              default_tax_code_id, is_active, updated_at
       FROM items
       WHERE company_id = $1 AND ($2::timestamptz IS NULL OR updated_at > $2)
       ORDER BY updated_at`,
      [request.companyId, query.updatedSince ?? null],
    );

    const variants = await pool.query(
      `SELECT iv.id, iv.item_id, iv.variant_code, iv.color, iv.size, iv.is_active,
              json_agg(json_build_object('id', ib.id, 'barcode', ib.barcode, 'unitOfMeasureId', ib.unit_of_measure_id, 'isPrimary', ib.is_primary))
                FILTER (WHERE ib.id IS NOT NULL) AS barcodes
       FROM item_variants iv
       LEFT JOIN item_barcodes ib ON ib.item_variant_id = iv.id
       WHERE iv.company_id = $1
       GROUP BY iv.id`,
      [request.companyId],
    );

    const variantsByItem = new Map<string, unknown[]>();
    for (const v of variants.rows) {
      const list = variantsByItem.get(v.item_id) ?? [];
      list.push(v);
      variantsByItem.set(v.item_id, list);
    }

    return items.rows.map((item) => ({ ...item, variants: variantsByItem.get(item.id) ?? [] }));
  });
}
