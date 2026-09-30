import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { newClient } from "./helpers.js";
import { withTransaction } from "../src/api/db.js";
import { importItemRow, type ItemImportRow } from "../src/inventory/itemImportService.js";

let client: Client;
let companyId: string;
let storeId: string;
let userId: string;

beforeAll(async () => {
  client = newClient();
  await client.connect();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co Import', 'شركة') RETURNING id`,
    [`TEST_IMPORT_${randomUUID().slice(0, 8)}`],
  );
  companyId = company.rows[0].id;

  const branch = await client.query(
    `INSERT INTO branches (company_id, branch_code, name_en, name_ar) VALUES ($1, 'HQ', 'HQ', 'المقر') RETURNING id`,
    [companyId],
  );
  const store = await client.query(
    `INSERT INTO stores (company_id, branch_id, store_code, name_en, name_ar) VALUES ($1, $2, 'S1', 'Store 1', 'متجر 1') RETURNING id`,
    [companyId, branch.rows[0].id],
  );
  storeId = store.rows[0].id;

  await client.query(
    `INSERT INTO units_of_measure (company_id, code, name_en, name_ar) VALUES ($1, 'PC', 'Piece', 'قطعة')`,
    [companyId],
  );
  await client.query(
    `INSERT INTO tax_codes (company_id, code, name_en, name_ar, rate, tax_type) VALUES ($1, 'VAT15', 'x', 'x', 15, 'standard')`,
    [companyId],
  );
  await client.query(
    `INSERT INTO price_lists (company_id, code, name_en, name_ar, price_includes_vat) VALUES ($1, 'RETAIL', 'Retail', 'x', true)`,
    [companyId],
  );
  await client.query(
    `INSERT INTO price_lists (company_id, code, name_en, name_ar, price_includes_vat) VALUES ($1, 'WHOLESALE', 'Wholesale', 'x', false)`,
    [companyId],
  );

  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, 'x', 'Importer', 'مستورد') RETURNING id`,
    [`importer_${randomUUID()}@test.local`],
  );
  userId = user.rows[0].id;
});

afterAll(async () => {
  await client.query(`SET app.bypass_immutability = 'true'`);
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_movements WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_balances WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM price_list_items WHERE price_list_id IN (SELECT id FROM price_lists WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM price_lists WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_barcodes WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_variants WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_units WHERE item_id IN (SELECT id FROM items WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM items WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM tax_codes WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM units_of_measure WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

function baseRow(overrides: Partial<ItemImportRow>): ItemImportRow {
  return {
    itemCode: `IT-${randomUUID().slice(0, 8)}`,
    variantCode: `SKU-${randomUUID().slice(0, 8)}`,
    nameEn: "Imported Item",
    nameAr: "صنف مستورد",
    baseUnitCode: "PC",
    ...overrides,
  };
}

describe("bulk item import", () => {
  it("creates a new item, its variant, and a valid internal EAN-13 barcode", async () => {
    const row = baseRow({ color: "Blue", size: "L", standardCost: 12.5, weightKg: 0.3 });
    const result = await withTransaction((c) => importItemRow(c, { companyId, createdBy: userId, row }), userId);

    expect(result.internalBarcode).toMatch(/^20\d{10}\d$/);
    // Validate the EAN-13 check digit is actually correct, not just present.
    const digits = result.internalBarcode.split("").map(Number);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += i % 2 === 0 ? digits[i]! : digits[i]! * 3;
    const expectedCheck = (10 - (sum % 10)) % 10;
    expect(digits[12]).toBe(expectedCheck);

    const variant = await client.query(`SELECT color, size, standard_cost, weight_kg FROM item_variants WHERE id = $1`, [result.variantId]);
    expect(variant.rows[0].color).toBe("Blue");
    expect(Number(variant.rows[0].standard_cost)).toBe(12.5);

    const barcodes = await client.query(`SELECT barcode, is_primary FROM item_barcodes WHERE item_variant_id = $1`, [result.variantId]);
    expect(barcodes.rows).toHaveLength(1);
    expect(barcodes.rows[0].barcode).toBe(result.internalBarcode);
    expect(barcodes.rows[0].is_primary).toBe(true);
  });

  it("adds a supplier barcode alongside the auto-generated internal one when the row supplies one", async () => {
    const row = baseRow({ barcode: "6281234500000" });
    const result = await withTransaction((c) => importItemRow(c, { companyId, createdBy: userId, row }), userId);

    const barcodes = await client.query(
      `SELECT barcode, is_primary FROM item_barcodes WHERE item_variant_id = $1 ORDER BY is_primary DESC`,
      [result.variantId],
    );
    expect(barcodes.rows).toHaveLength(2);
    expect(barcodes.rows[0].barcode).toBe(result.internalBarcode);
    expect(barcodes.rows[0].is_primary).toBe(true);
    expect(barcodes.rows[1].barcode).toBe("6281234500000");
    expect(barcodes.rows[1].is_primary).toBe(false);
  });

  it("reuses an existing item for a second variant row with the same item_code, without touching item-level fields", async () => {
    const itemCode = `IT-${randomUUID().slice(0, 8)}`;
    const first = await withTransaction(
      (c) => importItemRow(c, { companyId, createdBy: userId, row: baseRow({ itemCode, color: "Red", material: "Cotton" }) }),
      userId,
    );
    const second = await withTransaction(
      (c) => importItemRow(c, { companyId, createdBy: userId, row: baseRow({ itemCode, color: "Green", material: "Should be ignored" }) }),
      userId,
    );

    expect(second.itemId).toBe(first.itemId);
    const item = await client.query(`SELECT material FROM items WHERE id = $1`, [first.itemId]);
    expect(item.rows[0].material).toBe("Cotton"); // not overwritten by the second row

    const variants = await client.query(`SELECT color FROM item_variants WHERE item_id = $1 ORDER BY color`, [first.itemId]);
    expect(variants.rows.map((r) => r.color)).toEqual(["Green", "Red"]);
  });

  it("rejects a duplicate variant_code", async () => {
    const variantCode = `SKU-${randomUUID().slice(0, 8)}`;
    await withTransaction((c) => importItemRow(c, { companyId, createdBy: userId, row: baseRow({ variantCode }) }), userId);
    await expect(
      withTransaction((c) => importItemRow(c, { companyId, createdBy: userId, row: baseRow({ variantCode }) }), userId),
    ).rejects.toThrow(/already exists/);
  });

  it("rejects creating a new item without base_unit_code", async () => {
    const row = baseRow({ baseUnitCode: undefined });
    await expect(withTransaction((c) => importItemRow(c, { companyId, createdBy: userId, row }), userId)).rejects.toThrow(
      /base_unit_code/,
    );
  });

  it("rejects creating a new item without name_en", async () => {
    const row = baseRow({ nameEn: undefined });
    await expect(withTransaction((c) => importItemRow(c, { companyId, createdBy: userId, row }), userId)).rejects.toThrow(
      /name_en/,
    );
  });

  it("falls back name_ar to name_en when a row leaves it blank", async () => {
    const row = baseRow({ nameEn: "Untranslated Item", nameAr: undefined });
    const result = await withTransaction((c) => importItemRow(c, { companyId, createdBy: userId, row }), userId);

    const item = await client.query(`SELECT name_en, name_ar FROM items WHERE id = $1`, [result.itemId]);
    expect(item.rows[0].name_en).toBe("Untranslated Item");
    expect(item.rows[0].name_ar).toBe("Untranslated Item");
  });

  it("sets prices across multiple price levels and books opening stock", async () => {
    const row = baseRow({ standardCost: 10, retailPrice: 25, wholesalePrice: 18, storeCode: "S1", openingQty: 40 });
    const result = await withTransaction((c) => importItemRow(c, { companyId, createdBy: userId, row }), userId);

    const prices = await client.query(
      `SELECT pl.code, pli.price FROM price_list_items pli JOIN price_lists pl ON pl.id = pli.price_list_id
       WHERE pli.item_variant_id = $1 ORDER BY pl.code`,
      [result.variantId],
    );
    expect(prices.rows).toEqual([
      { code: "RETAIL", price: "25.00" },
      { code: "WHOLESALE", price: "18.00" },
    ]);

    const balance = await client.query(
      `SELECT qty_on_hand FROM stock_balances WHERE store_id = $1 AND item_variant_id = $2`,
      [storeId, result.variantId],
    );
    expect(Number(balance.rows[0].qty_on_hand)).toBe(40);
  });

  it("generates unique, sequential internal barcodes across many rows in the same company", async () => {
    const barcodes = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const result = await withTransaction((c) => importItemRow(c, { companyId, createdBy: userId, row: baseRow({}) }), userId);
      barcodes.add(result.internalBarcode);
    }
    expect(barcodes.size).toBe(5);
  });
});
