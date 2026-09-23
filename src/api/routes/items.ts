import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";

const listQuerySchema = z.object({
  updatedSince: z.string().datetime().optional(),
});

const createSchema = z.object({
  itemCode: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  // Minimal single-variant creation, not the full color/size matrix a real
  // "new item" wizard would offer -- variantCode is required, color/size
  // optional, matching what item_variants actually requires (UNIQUE on
  // (item_id, color, size), so a second variant would need its own call).
  variantCode: z.string().min(1),
  color: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
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
        await client.query(
          `INSERT INTO item_variants (company_id, item_id, variant_code, color, size)
           VALUES ($1, $2, $3, $4, $5)`,
          [request.companyId, item.rows[0]!.id, body.variantCode, body.color ?? null, body.size ?? null],
        );
        return item.rows[0]!.id;
      }, request.authUser.id);
      reply.status(201);
      return { id: itemId };
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
              json_agg(json_build_object('barcode', ib.barcode, 'unitOfMeasureId', ib.unit_of_measure_id, 'isPrimary', ib.is_primary))
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
