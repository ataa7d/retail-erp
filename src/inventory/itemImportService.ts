/**
 * Bulk item import: one CSV row creates (or adds a variant to) an item,
 * generates an internal barcode for the new variant, optionally files the
 * supplier's own barcode alongside it, sets prices across whichever price
 * levels the row supplies, and optionally books an opening stock quantity.
 *
 * Each row is applied by the caller in its own transaction (see
 * POST /items/bulk-import) so one bad row out of a thousand doesn't roll
 * back the other 999 -- this file only knows how to apply a single row.
 */

import type { Client } from "pg";
import { recordStockMovement } from "./inventoryService.js";

export interface ItemImportRow {
  itemCode: string;
  variantCode: string;
  nameEn?: string;
  nameAr?: string;
  brandCode?: string;
  categoryCode?: string;
  seasonCode?: string;
  itemYear?: number;
  material?: string;
  countryOfOrigin?: string;
  supplierStyleNumber?: string;
  baseUnitCode?: string;
  defaultTaxCode?: string;
  color?: string;
  size?: string;
  barcode?: string;
  standardCost?: number;
  weightKg?: number;
  reorderPoint?: number;
  storeCode?: string;
  openingQty?: number;
  retailPrice?: number;
  wholesalePrice?: number;
  tenderPrice?: number;
  bigsalePrice?: number;
  referencePrice?: number;
}

export interface ImportItemRowParams {
  companyId: string;
  createdBy: string | null;
  row: ItemImportRow;
}

export interface ImportItemRowResult {
  itemId: string;
  variantId: string;
  internalBarcode: string;
}

function ean13CheckDigit(digits12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(digits12[i]);
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * A gap-free, per-company sequence reusing the generic number_sequences
 * table (migration 0005) under its own document_type -- fiscal_year is
 * pinned to 0 since an internal barcode isn't year-scoped. GS1 reserves
 * prefix 20-29 for in-store/internal use in EAN-13, so "20" + a 10-digit
 * sequence + check digit can never collide with a real manufacturer
 * UPC/EAN a supplier might also hand us for the same variant.
 */
export async function nextInternalBarcode(client: Client, companyId: string): Promise<string> {
  await client.query(
    `INSERT INTO number_sequences (company_id, document_type, fiscal_year, prefix, padding)
     VALUES ($1, 'internal_barcode', 0, '20', 10)
     ON CONFLICT (company_id, document_type, fiscal_year) DO NOTHING`,
    [companyId],
  );
  const seq = await client.query<{ next_value: string }>(
    `SELECT next_value FROM number_sequences
     WHERE company_id = $1 AND document_type = 'internal_barcode' AND fiscal_year = 0
     FOR UPDATE`,
    [companyId],
  );
  const next = BigInt(seq.rows[0]!.next_value);
  await client.query(
    `UPDATE number_sequences SET next_value = next_value + 1
     WHERE company_id = $1 AND document_type = 'internal_barcode' AND fiscal_year = 0`,
    [companyId],
  );
  const body = "20" + next.toString().padStart(10, "0");
  return body + ean13CheckDigit(body).toString();
}

async function lookupIdByCode(
  client: Client,
  table: string,
  companyId: string,
  code: string,
  label: string,
  codeColumn: string = "code",
): Promise<string> {
  const r = await client.query<{ id: string }>(`SELECT id FROM ${table} WHERE company_id = $1 AND ${codeColumn} = $2`, [companyId, code]);
  if (r.rows.length === 0) throw new Error(`${label} "${code}" not found`);
  return r.rows[0]!.id;
}

const PRICE_LIST_COLUMNS: Array<[code: string, pick: (row: ItemImportRow) => number | undefined]> = [
  ["RETAIL", (r) => r.retailPrice],
  ["WHOLESALE", (r) => r.wholesalePrice],
  ["TENDER", (r) => r.tenderPrice],
  ["BIGSALE", (r) => r.bigsalePrice],
  ["REFERENCE", (r) => r.referencePrice],
];

export async function importItemRow(client: Client, p: ImportItemRowParams): Promise<ImportItemRowResult> {
  const { companyId, row } = p;

  const existingItem = await client.query<{ id: string }>(`SELECT id FROM items WHERE company_id = $1 AND item_code = $2`, [
    companyId,
    row.itemCode,
  ]);

  let itemId: string;
  if (existingItem.rows.length > 0) {
    // Item already exists -- this row is just adding another variant to it.
    // Item-level fields (name, brand, material, ...) are never overwritten
    // from a bulk sheet, only set at creation time, so a stray or blank
    // cell in a later row can't silently clobber curated item data.
    itemId = existingItem.rows[0]!.id;
  } else {
    if (!row.nameEn || !row.nameAr) {
      throw new Error(`item "${row.itemCode}" does not exist yet and needs name_en and name_ar to be created`);
    }
    if (!row.baseUnitCode) {
      throw new Error(`item "${row.itemCode}" does not exist yet and needs base_unit_code to be created`);
    }
    const baseUnitId = await lookupIdByCode(client, "units_of_measure", companyId, row.baseUnitCode, "unit of measure");
    const brandId = row.brandCode ? await lookupIdByCode(client, "brands", companyId, row.brandCode, "brand") : null;
    const categoryId = row.categoryCode ? await lookupIdByCode(client, "categories", companyId, row.categoryCode, "category") : null;
    const seasonId = row.seasonCode ? await lookupIdByCode(client, "seasons", companyId, row.seasonCode, "season") : null;
    const taxCodeId = row.defaultTaxCode ? await lookupIdByCode(client, "tax_codes", companyId, row.defaultTaxCode, "tax code") : null;

    const created = await client.query<{ id: string }>(
      `INSERT INTO items (company_id, item_code, name_en, name_ar, brand_id, category_id, season_id, item_year,
                          default_tax_code_id, material, country_of_origin, supplier_style_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [
        companyId, row.itemCode, row.nameEn, row.nameAr, brandId, categoryId, seasonId, row.itemYear ?? null,
        taxCodeId, row.material ?? null, row.countryOfOrigin ?? null, row.supplierStyleNumber ?? null,
      ],
    );
    itemId = created.rows[0]!.id;

    await client.query(
      `INSERT INTO item_units (item_id, unit_of_measure_id, conversion_factor, is_base) VALUES ($1, $2, 1, true)`,
      [itemId, baseUnitId],
    );
  }

  const existingVariant = await client.query(`SELECT id FROM item_variants WHERE company_id = $1 AND variant_code = $2`, [
    companyId,
    row.variantCode,
  ]);
  if (existingVariant.rows.length > 0) {
    throw new Error(`variant code "${row.variantCode}" already exists`);
  }

  const variant = await client.query<{ id: string }>(
    `INSERT INTO item_variants (company_id, item_id, variant_code, color, size, reorder_point, standard_cost, weight_kg)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      companyId, itemId, row.variantCode, row.color ?? null, row.size ?? null,
      row.reorderPoint ?? 0, row.standardCost ?? null, row.weightKg ?? null,
    ],
  );
  const variantId = variant.rows[0]!.id;

  const baseUnit = await client.query<{ unit_of_measure_id: string }>(
    `SELECT unit_of_measure_id FROM item_units WHERE item_id = $1 AND is_base = true`,
    [itemId],
  );
  const baseUnitId = baseUnit.rows[0]!.unit_of_measure_id;

  const internalBarcode = await nextInternalBarcode(client, companyId);
  await client.query(
    `INSERT INTO item_barcodes (company_id, item_variant_id, unit_of_measure_id, barcode, is_primary) VALUES ($1, $2, $3, $4, true)`,
    [companyId, variantId, baseUnitId, internalBarcode],
  );
  if (row.barcode) {
    await client.query(
      `INSERT INTO item_barcodes (company_id, item_variant_id, unit_of_measure_id, barcode, is_primary) VALUES ($1, $2, $3, $4, false)`,
      [companyId, variantId, baseUnitId, row.barcode],
    );
  }

  for (const [code, pick] of PRICE_LIST_COLUMNS) {
    const price = pick(row);
    if (price === undefined) continue;
    const list = await client.query<{ id: string }>(`SELECT id FROM price_lists WHERE company_id = $1 AND code = $2`, [companyId, code]);
    if (list.rows.length === 0) continue; // that price level isn't set up for this company -- skip, don't fail the row
    await client.query(
      `INSERT INTO price_list_items (price_list_id, item_variant_id, price) VALUES ($1, $2, $3)
       ON CONFLICT (price_list_id, item_variant_id) DO UPDATE SET price = EXCLUDED.price, is_active = true`,
      [list.rows[0]!.id, variantId, price],
    );
  }

  if (row.storeCode && row.openingQty !== undefined && row.openingQty > 0) {
    const storeId = await lookupIdByCode(client, "stores", companyId, row.storeCode, "store", "store_code");
    // adjustment_in, not receipt -- there's no supplier/PO behind an
    // opening balance loaded from a spreadsheet, and no GL entry either
    // (same as any other quantity/cost adjustment in this file); a real
    // inventory-value opening journal is a separate, deliberate accounting
    // action outside the scope of a catalog import.
    await recordStockMovement(client, {
      companyId,
      storeId,
      itemVariantId: variantId,
      movementType: "adjustment_in",
      qty: row.openingQty,
      explicitUnitCost: row.standardCost,
      reasonCode: "bulk_import_opening_stock",
      sourceType: "item_bulk_import",
      createdBy: p.createdBy,
    });
  }

  return { itemId, variantId, internalBarcode };
}
