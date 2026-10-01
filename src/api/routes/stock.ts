import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

const querySchema = z.object({
  storeId: z.string().uuid(),
});

const STOCK_SORT_COLUMNS = {
  variantCode: "iv.variant_code",
  itemCode: "i.item_code",
  name: "i.name_en",
  color: "iv.color",
  size: "iv.size",
  qty: "qty_on_hand",
} as const;

const stockVariantQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
  search: z.string().trim().min(1).optional(),
  itemCode: z.string().trim().min(1).optional(),
  variantCode: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  color: z.string().trim().min(1).optional(),
  size: z.string().trim().min(1).optional(),
  barcode: z.string().trim().min(1).optional(),
  brandId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  seasonId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  // Narrows qty_on_hand/stores_in_stock to one store instead of summing
  // across all of them -- how this screen stays usable with any number of
  // stores: never one column per store, just an optional filter.
  storeId: z.string().uuid().optional(),
  belowReorderPoint: z.enum(["true"]).optional(),
  sortBy: z.enum(Object.keys(STOCK_SORT_COLUMNS) as [keyof typeof STOCK_SORT_COLUMNS, ...Array<keyof typeof STOCK_SORT_COLUMNS>]).default("itemCode"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
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

  // The Stock screen itself: same paginated/filterable/sortable shape as
  // GET /item-variants (search, item code, color, size, barcode, brand,
  // category, season, group), plus availability. Scales to any number of
  // stores because a store is a filter here, never a column -- the
  // optional storeId narrows qty_on_hand/stores_in_stock to just that
  // store; omitted, they're summed/counted across every store.
  app.get("/stock-balances/variants", { preHandler: app.authenticate }, async (request) => {
    const q = stockVariantQuerySchema.parse(request.query);

    const conditions: string[] = ["iv.company_id = $1"];
    const params: unknown[] = [request.companyId];

    function addFilter(sql: string, value: unknown) {
      params.push(value);
      conditions.push(sql.replaceAll("?", `$${params.length}`));
    }

    if (q.search) {
      addFilter(
        "(iv.variant_code ILIKE '%' || ? || '%' OR i.item_code ILIKE '%' || ? || '%' OR i.name_en ILIKE '%' || ? || '%' OR i.name_ar ILIKE '%' || ? || '%')",
        q.search,
      );
    }
    if (q.itemCode) addFilter("i.item_code ILIKE '%' || ? || '%'", q.itemCode);
    if (q.variantCode) addFilter("iv.variant_code ILIKE '%' || ? || '%'", q.variantCode);
    if (q.name) addFilter("(i.name_en ILIKE '%' || ? || '%' OR i.name_ar ILIKE '%' || ? || '%')", q.name);
    if (q.color) addFilter("iv.color ILIKE '%' || ? || '%'", q.color);
    if (q.size) addFilter("iv.size ILIKE '%' || ? || '%'", q.size);
    if (q.barcode) addFilter("EXISTS (SELECT 1 FROM item_barcodes ib WHERE ib.item_variant_id = iv.id AND ib.barcode ILIKE '%' || ? || '%')", q.barcode);
    if (q.brandId) addFilter("i.brand_id = ?", q.brandId);
    if (q.categoryId) addFilter("i.category_id = ?", q.categoryId);
    if (q.seasonId) addFilter("i.season_id = ?", q.seasonId);
    if (q.groupId) addFilter("i.group_id = ?", q.groupId);

    // Stock aggregated per variant -- across every store, or just one when
    // storeId narrows it. Built as a subquery so the WHERE above (on item/
    // variant columns) and this (on stock_balances) don't fight each other.
    params.push(q.storeId ?? null);
    const storeFilterParam = params.length;
    const stockJoin = `
      LEFT JOIN (
        SELECT item_variant_id, SUM(qty_on_hand) AS qty_on_hand, COUNT(*) FILTER (WHERE qty_on_hand <> 0) AS stores_in_stock
        FROM stock_balances
        WHERE $${storeFilterParam}::uuid IS NULL OR store_id = $${storeFilterParam}
        GROUP BY item_variant_id
      ) sb ON sb.item_variant_id = iv.id`;

    if (q.belowReorderPoint === "true") {
      conditions.push("iv.reorder_point > 0 AND COALESCE(sb.qty_on_hand, 0) < iv.reorder_point");
    }

    const sortColumn = STOCK_SORT_COLUMNS[q.sortBy];
    const offset = (q.page - 1) * q.pageSize;
    params.push(q.pageSize, offset);

    const result = await pool.query(
      `SELECT iv.id, iv.variant_code, iv.color, iv.size, iv.is_active, iv.reorder_point,
              i.id AS item_id, i.item_code, i.name_en, i.name_ar,
              b.name_en AS brand_name, c.name_en AS category_name, s.name_en AS season_name, g.name_en AS group_name,
              (SELECT ib.barcode FROM item_barcodes ib WHERE ib.item_variant_id = iv.id AND ib.is_primary = true LIMIT 1) AS primary_barcode,
              COALESCE(sb.qty_on_hand, 0) AS qty_on_hand, COALESCE(sb.stores_in_stock, 0) AS stores_in_stock,
              COUNT(*) OVER() AS total_count
       FROM item_variants iv
       JOIN items i ON i.id = iv.item_id
       LEFT JOIN brands b ON b.id = i.brand_id
       LEFT JOIN categories c ON c.id = i.category_id
       LEFT JOIN seasons s ON s.id = i.season_id
       LEFT JOIN item_groups g ON g.id = i.group_id
       ${stockJoin}
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${sortColumn} ${q.sortDir === "desc" ? "DESC" : "ASC"}, iv.id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const total = result.rows.length > 0 ? Number(result.rows[0]!.total_count) : 0;
    const rows = result.rows.map(({ total_count, ...row }) => row);
    return { rows, total, page: q.page, pageSize: q.pageSize };
  });

  // Per-store breakdown for one variant -- the drill-down behind a "View by
  // store" action on a row, so the full per-store split is one click away
  // without ever needing a column per store in the main grid.
  app.get<{ Params: { variantId: string } }>(
    "/stock-balances/variants/:variantId/by-store",
    { preHandler: app.authenticate },
    async (request) => {
      const result = await pool.query<{ store_id: string; store_name_en: string; store_name_ar: string; qty_on_hand: string }>(
        `SELECT s.id AS store_id, s.name_en AS store_name_en, s.name_ar AS store_name_ar, COALESCE(sb.qty_on_hand, 0) AS qty_on_hand
         FROM stores s
         JOIN item_variants iv ON iv.id = $2 AND iv.company_id = s.company_id
         LEFT JOIN stock_balances sb ON sb.store_id = s.id AND sb.item_variant_id = $2
         WHERE s.company_id = $1 AND s.is_active = true
         ORDER BY s.name_en`,
        [request.companyId, request.params.variantId],
      );
      return { rows: result.rows };
    },
  );
}
