import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import { pool, withTransaction } from "../db.js";
import { NotFoundError, BusinessRuleError } from "../errors.js";
import { importItemRow, type ItemImportRow } from "../../inventory/itemImportService.js";

const listQuerySchema = z.object({
  updatedSince: z.string().datetime().optional(),
});

const createSchema = z.object({
  itemCode: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  baseUnitOfMeasureId: z.string().uuid(),
  brandId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  seasonId: z.string().uuid().nullable().optional(),
  itemYear: z.number().int().nullable().optional(),
  defaultTaxCodeId: z.string().uuid().nullable().optional(),
  material: z.string().nullable().optional(),
  countryOfOrigin: z.string().nullable().optional(),
  supplierStyleNumber: z.string().nullable().optional(),
  // Minimal single-variant creation, not the full color/size matrix a real
  // "new item" wizard would offer -- variantCode is required, color/size
  // optional, matching what item_variants actually requires (UNIQUE on
  // (item_id, color, size)). Additional variants are added afterward via
  // POST /items/:id/variants.
  variantCode: z.string().min(1),
  color: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  reorderPoint: z.number().nonnegative().optional(),
  standardCost: z.number().nonnegative().nullable().optional(),
  weightKg: z.number().nonnegative().nullable().optional(),
});

const classifySchema = z.object({
  brandId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  seasonId: z.string().uuid().nullable().optional(),
  itemYear: z.number().int().nullable().optional(),
  defaultTaxCodeId: z.string().uuid().nullable().optional(),
  material: z.string().nullable().optional(),
  countryOfOrigin: z.string().nullable().optional(),
  supplierStyleNumber: z.string().nullable().optional(),
});

const addVariantSchema = z.object({
  variantCode: z.string().min(1),
  color: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  reorderPoint: z.number().nonnegative().optional(),
  standardCost: z.number().nonnegative().nullable().optional(),
  weightKg: z.number().nonnegative().nullable().optional(),
});

const addBarcodeSchema = z.object({
  barcode: z.string().min(1),
  unitOfMeasureId: z.string().uuid(),
  isPrimary: z.boolean().default(true),
});

const reorderPointSchema = z.object({
  reorderPoint: z.number().nonnegative(),
});

const variantAttributesSchema = z.object({
  standardCost: z.number().nonnegative().nullable().optional(),
  weightKg: z.number().nonnegative().nullable().optional(),
});

export async function itemRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/items",
    { preHandler: [app.authenticate, app.requirePermission("inventory.items.manage")] },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      const itemId = await withTransaction(async (client) => {
        const item = await client.query<{ id: string }>(
          `INSERT INTO items (company_id, item_code, name_en, name_ar, brand_id, category_id, season_id, item_year,
                              default_tax_code_id, material, country_of_origin, supplier_style_number)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
          [
            request.companyId,
            body.itemCode,
            body.nameEn,
            body.nameAr,
            body.brandId ?? null,
            body.categoryId ?? null,
            body.seasonId ?? null,
            body.itemYear ?? null,
            body.defaultTaxCodeId ?? null,
            body.material ?? null,
            body.countryOfOrigin ?? null,
            body.supplierStyleNumber ?? null,
          ],
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
          `INSERT INTO item_variants (company_id, item_id, variant_code, color, size, reorder_point, standard_cost, weight_kg)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            request.companyId, newItemId, body.variantCode, body.color ?? null, body.size ?? null,
            body.reorderPoint ?? 0, body.standardCost ?? null, body.weightKg ?? null,
          ],
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
          `INSERT INTO item_variants (company_id, item_id, variant_code, color, size, reorder_point, standard_cost, weight_kg)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            request.companyId, request.params.id, body.variantCode, body.color ?? null, body.size ?? null,
            body.reorderPoint ?? 0, body.standardCost ?? null, body.weightKg ?? null,
          ],
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
    "/items/:id/classify",
    { preHandler: [app.authenticate, app.requirePermission("inventory.items.manage")] },
    async (request) => {
      const body = classifySchema.parse(request.body);
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM items WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("item not found");
        await client.query(
          `UPDATE items SET brand_id = $1, category_id = $2, season_id = $3, item_year = $4, default_tax_code_id = $5,
                            material = $6, country_of_origin = $7, supplier_style_number = $8
           WHERE id = $9`,
          [
            body.brandId ?? null,
            body.categoryId ?? null,
            body.seasonId ?? null,
            body.itemYear ?? null,
            body.defaultTaxCodeId ?? null,
            body.material ?? null,
            body.countryOfOrigin ?? null,
            body.supplierStyleNumber ?? null,
            request.params.id,
          ],
        );
      }, request.authUser.id);
      return { id: request.params.id };
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

  app.post<{ Params: { id: string } }>(
    "/item-variants/:id/reorder-point",
    { preHandler: [app.authenticate, app.requirePermission("inventory.items.manage")] },
    async (request) => {
      const body = reorderPointSchema.parse(request.body);
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM item_variants WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("item variant not found");
        await client.query(`UPDATE item_variants SET reorder_point = $1 WHERE id = $2`, [body.reorderPoint, request.params.id]);
      }, request.authUser.id);
      return { id: request.params.id, reorderPoint: body.reorderPoint };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/item-variants/:id/attributes",
    { preHandler: [app.authenticate, app.requirePermission("inventory.items.manage")] },
    async (request) => {
      const body = variantAttributesSchema.parse(request.body);
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM item_variants WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("item variant not found");
        await client.query(`UPDATE item_variants SET standard_cost = $1, weight_kg = $2 WHERE id = $3`, [
          body.standardCost ?? null,
          body.weightKg ?? null,
          request.params.id,
        ]);
      }, request.authUser.id);
      return { id: request.params.id, standardCost: body.standardCost ?? null, weightKg: body.weightKg ?? null };
    },
  );

  // Bulk item import: one CSV row per variant, creating the parent item the
  // first time its item_code is seen and just adding a variant on later
  // rows for the same item_code. Each row is applied in its own
  // transaction so a typo in row 743 doesn't roll back the other 999 --
  // the response reports success/failure per row instead of all-or-nothing.
  app.post(
    "/items/bulk-import",
    { preHandler: [app.authenticate, app.requirePermission("inventory.items.manage")] },
    async (request) => {
      const file = await request.file();
      if (!file) throw new BusinessRuleError("no file uploaded");
      const text = (await file.toBuffer()).toString("utf-8");

      let records: Record<string, string>[];
      try {
        records = parse(text, { columns: true, trim: true, skip_empty_lines: true, bom: true, relax_column_count: true });
      } catch (err) {
        throw new BusinessRuleError(`failed to parse CSV: ${err instanceof Error ? err.message : "invalid file"}`);
      }

      function num(raw: string | undefined, field: string): number | undefined {
        if (raw === undefined || raw === "") return undefined;
        const n = Number(raw);
        if (!Number.isFinite(n)) throw new Error(`invalid number for ${field}: "${raw}"`);
        return n;
      }

      const results: Array<{ row: number; itemCode: string; variantCode: string; status: "created" | "error"; message?: string; internalBarcode?: string }> = [];
      let created = 0;
      let failed = 0;

      for (let i = 0; i < records.length; i++) {
        const rowNumber = i + 2; // header is row 1
        const raw = records[i]!;
        const itemCode = raw.item_code?.trim() ?? "";
        const variantCode = raw.variant_code?.trim() ?? "";

        try {
          if (!itemCode || !variantCode) {
            throw new Error("item_code and variant_code are required");
          }
          const row: ItemImportRow = {
            itemCode,
            variantCode,
            nameEn: raw.name_en || undefined,
            nameAr: raw.name_ar || undefined,
            brandCode: raw.brand_code || undefined,
            categoryCode: raw.category_code || undefined,
            seasonCode: raw.season_code || undefined,
            itemYear: num(raw.item_year, "item_year"),
            material: raw.material || undefined,
            countryOfOrigin: raw.country_of_origin || undefined,
            supplierStyleNumber: raw.supplier_style_number || undefined,
            baseUnitCode: raw.base_unit_code || undefined,
            defaultTaxCode: raw.default_tax_code || undefined,
            color: raw.color || undefined,
            size: raw.size || undefined,
            barcode: raw.barcode || undefined,
            standardCost: num(raw.standard_cost, "standard_cost"),
            weightKg: num(raw.weight_kg, "weight_kg"),
            reorderPoint: num(raw.reorder_point, "reorder_point"),
            storeCode: raw.store_code || undefined,
            openingQty: num(raw.opening_qty, "opening_qty"),
            retailPrice: num(raw.retail_price, "retail_price"),
            wholesalePrice: num(raw.wholesale_price, "wholesale_price"),
            tenderPrice: num(raw.tender_price, "tender_price"),
            bigsalePrice: num(raw.bigsale_price, "bigsale_price"),
            referencePrice: num(raw.reference_price, "reference_price"),
          };

          const outcome = await withTransaction(
            (client) => importItemRow(client, { companyId: request.companyId, createdBy: request.authUser.id, row }),
            request.authUser.id,
          );
          created++;
          results.push({ row: rowNumber, itemCode, variantCode, status: "created", internalBarcode: outcome.internalBarcode });
        } catch (err) {
          failed++;
          results.push({ row: rowNumber, itemCode, variantCode, status: "error", message: err instanceof Error ? err.message : "unknown error" });
        }
      }

      return { totalRows: records.length, created, failed, results };
    },
  );

  // Master data syncs one way, down — updatedSince lets a client (POS,
  // admin UI) pull only what changed since its last sync.
  app.get("/items", { preHandler: app.authenticate }, async (request) => {
    const query = listQuerySchema.parse(request.query);

    const items = await pool.query(
      `SELECT id, item_code, name_en, name_ar, brand_id, category_id, season_id, item_year,
              default_tax_code_id, material, country_of_origin, supplier_style_number, is_active, updated_at
       FROM items
       WHERE company_id = $1 AND ($2::timestamptz IS NULL OR updated_at > $2)
       ORDER BY updated_at`,
      [request.companyId, query.updatedSince ?? null],
    );

    const variants = await pool.query(
      `SELECT iv.id, iv.item_id, iv.variant_code, iv.color, iv.size, iv.is_active, iv.reorder_point,
              iv.standard_cost, iv.weight_kg,
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
