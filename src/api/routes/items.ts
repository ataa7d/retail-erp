import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

const listQuerySchema = z.object({
  updatedSince: z.string().datetime().optional(),
});

export async function itemRoutes(app: FastifyInstance): Promise<void> {
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
