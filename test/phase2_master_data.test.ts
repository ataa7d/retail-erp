import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { newClient } from "./helpers.js";

let client: Client;
let companyAId: string;
let companyBId: string;
let pcUnitId: string;
let boxUnitId: string;

beforeAll(async () => {
  client = newClient();
  await client.connect();

  const a = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co A', 'شركة أ') RETURNING id`,
    [`TEST_A_${randomUUID().slice(0, 8)}`],
  );
  companyAId = a.rows[0].id;

  const b = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co B', 'شركة ب') RETURNING id`,
    [`TEST_B_${randomUUID().slice(0, 8)}`],
  );
  companyBId = b.rows[0].id;

  const pc = await client.query(
    `INSERT INTO units_of_measure (company_id, code, name_en, name_ar) VALUES ($1, 'PC', 'Piece', 'قطعة') RETURNING id`,
    [companyAId],
  );
  pcUnitId = pc.rows[0].id;

  const box = await client.query(
    `INSERT INTO units_of_measure (company_id, code, name_en, name_ar) VALUES ($1, 'BOX', 'Box', 'صندوق') RETURNING id`,
    [companyAId],
  );
  boxUnitId = box.rows[0].id;
});

afterAll(async () => {
  await client.query(`DELETE FROM audit_log WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM price_list_items WHERE price_list_id IN (SELECT id FROM price_lists WHERE company_id IN ($1, $2))`, [companyAId, companyBId]);
  await client.query(`DELETE FROM price_lists WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM item_barcodes WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM item_variants WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM item_units WHERE item_id IN (SELECT id FROM items WHERE company_id IN ($1, $2))`, [companyAId, companyBId]);
  await client.query(`DELETE FROM items WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM customers WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM suppliers WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM tax_codes WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM seasons WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM categories WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM brands WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM units_of_measure WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM companies WHERE id IN ($1, $2)`, [companyAId, companyBId]);
  await client.end();
});

async function createItem(companyId: string, itemCode: string) {
  const item = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, $2, 'Test Item', 'صنف اختبار') RETURNING id`,
    [companyId, itemCode],
  );
  return item.rows[0].id as string;
}

describe("tax codes", () => {
  it("rejects a non-standard tax type with a non-zero rate", async () => {
    await expect(
      client.query(
        `INSERT INTO tax_codes (company_id, code, name_en, name_ar, rate, tax_type)
         VALUES ($1, 'BAD', 'Bad', 'خطأ', 5, 'exempt')`,
        [companyAId],
      ),
    ).rejects.toThrow();
  });

  it("accepts standard 15% and zero-rated 0%", async () => {
    await client.query(
      `INSERT INTO tax_codes (company_id, code, name_en, name_ar, rate, tax_type) VALUES ($1, 'VAT15', 'x', 'x', 15, 'standard')`,
      [companyAId],
    );
    await client.query(
      `INSERT INTO tax_codes (company_id, code, name_en, name_ar, rate, tax_type) VALUES ($1, 'VAT0', 'x', 'x', 0, 'zero_rated')`,
      [companyAId],
    );
  });
});

describe("items and variants", () => {
  it("requires the base unit's conversion factor to be exactly 1", async () => {
    const itemId = await createItem(companyAId, `IT-${randomUUID().slice(0, 8)}`);
    await expect(
      client.query(
        `INSERT INTO item_units (item_id, unit_of_measure_id, conversion_factor, is_base) VALUES ($1, $2, 2, true)`,
        [itemId, pcUnitId],
      ),
    ).rejects.toThrow();
  });

  it("allows only one base unit per item", async () => {
    const itemId = await createItem(companyAId, `IT-${randomUUID().slice(0, 8)}`);
    await client.query(
      `INSERT INTO item_units (item_id, unit_of_measure_id, conversion_factor, is_base) VALUES ($1, $2, 1, true)`,
      [itemId, pcUnitId],
    );
    await expect(
      client.query(
        `INSERT INTO item_units (item_id, unit_of_measure_id, conversion_factor, is_base) VALUES ($1, $2, 1, true)`,
        [itemId, boxUnitId],
      ),
    ).rejects.toThrow();
  });

  it("rejects a barcode in a unit not registered for the item", async () => {
    const itemId = await createItem(companyAId, `IT-${randomUUID().slice(0, 8)}`);
    await client.query(
      `INSERT INTO item_units (item_id, unit_of_measure_id, conversion_factor, is_base) VALUES ($1, $2, 1, true)`,
      [itemId, pcUnitId],
    );
    const variant = await client.query(
      `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, $3) RETURNING id`,
      [companyAId, itemId, `SKU-${randomUUID().slice(0, 8)}`],
    );
    const variantId = variant.rows[0].id;

    // boxUnitId was never registered via item_units for this item.
    await expect(
      client.query(
        `INSERT INTO item_barcodes (company_id, item_variant_id, unit_of_measure_id, barcode) VALUES ($1, $2, $3, $4)`,
        [companyAId, variantId, boxUnitId, `BC-${randomUUID().slice(0, 8)}`],
      ),
    ).rejects.toThrow(/not registered/);
  });

  it("rejects two variants of the same item with the same color/size", async () => {
    const itemId = await createItem(companyAId, `IT-${randomUUID().slice(0, 8)}`);
    await client.query(
      `INSERT INTO item_variants (company_id, item_id, variant_code, color, size) VALUES ($1, $2, $3, 'Red', 'M')`,
      [companyAId, itemId, `SKU-${randomUUID().slice(0, 8)}`],
    );
    await expect(
      client.query(
        `INSERT INTO item_variants (company_id, item_id, variant_code, color, size) VALUES ($1, $2, $3, 'Red', 'M')`,
        [companyAId, itemId, `SKU-${randomUUID().slice(0, 8)}`],
      ),
    ).rejects.toThrow();
  });

  it("rejects a variant whose item belongs to a different company", async () => {
    const itemId = await createItem(companyAId, `IT-${randomUUID().slice(0, 8)}`);
    await expect(
      client.query(
        `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, $3)`,
        [companyBId, itemId, `SKU-${randomUUID().slice(0, 8)}`],
      ),
    ).rejects.toThrow(/does not belong to company/);
  });
});

describe("price lists", () => {
  it("allows only one default price list per company", async () => {
    await client.query(
      `INSERT INTO price_lists (company_id, code, name_en, name_ar, is_default) VALUES ($1, 'PL1', 'x', 'x', true)`,
      [companyAId],
    );
    await expect(
      client.query(
        `INSERT INTO price_lists (company_id, code, name_en, name_ar, is_default) VALUES ($1, 'PL2', 'x', 'x', true)`,
        [companyAId],
      ),
    ).rejects.toThrow();
  });

  it("rejects a price list item pairing a price list and variant from different companies", async () => {
    const itemId = await createItem(companyAId, `IT-${randomUUID().slice(0, 8)}`);
    const variant = await client.query(
      `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, $3) RETURNING id`,
      [companyAId, itemId, `SKU-${randomUUID().slice(0, 8)}`],
    );
    const priceList = await client.query(
      `INSERT INTO price_lists (company_id, code, name_en, name_ar) VALUES ($1, 'PLB', 'x', 'x') RETURNING id`,
      [companyBId],
    );

    await expect(
      client.query(
        `INSERT INTO price_list_items (price_list_id, item_variant_id, price) VALUES ($1, $2, 10)`,
        [priceList.rows[0].id, variant.rows[0].id],
      ),
    ).rejects.toThrow(/belong to different companies/);
  });

  it("rejects a negative price", async () => {
    const itemId = await createItem(companyAId, `IT-${randomUUID().slice(0, 8)}`);
    const variant = await client.query(
      `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, $3) RETURNING id`,
      [companyAId, itemId, `SKU-${randomUUID().slice(0, 8)}`],
    );
    const priceList = await client.query(
      `INSERT INTO price_lists (company_id, code, name_en, name_ar) VALUES ($1, 'PLC', 'x', 'x') RETURNING id`,
      [companyAId],
    );

    await expect(
      client.query(
        `INSERT INTO price_list_items (price_list_id, item_variant_id, price) VALUES ($1, $2, -1)`,
        [priceList.rows[0].id, variant.rows[0].id],
      ),
    ).rejects.toThrow();
  });
});

describe("customers", () => {
  it("allows only one customer per loyalty card number within a company", async () => {
    await client.query(
      `INSERT INTO customers (company_id, customer_code, name_en, name_ar, is_loyalty_member, loyalty_card_number)
       VALUES ($1, 'C1', 'x', 'x', true, 'LC-001')`,
      [companyAId],
    );
    await expect(
      client.query(
        `INSERT INTO customers (company_id, customer_code, name_en, name_ar, is_loyalty_member, loyalty_card_number)
         VALUES ($1, 'C2', 'x', 'x', true, 'LC-001')`,
        [companyAId],
      ),
    ).rejects.toThrow();
  });

  it("allows unlimited customers with no loyalty card (NULL is not a duplicate)", async () => {
    await client.query(`INSERT INTO customers (company_id, customer_code, name_en, name_ar) VALUES ($1, 'C3', 'x', 'x')`, [companyAId]);
    await client.query(`INSERT INTO customers (company_id, customer_code, name_en, name_ar) VALUES ($1, 'C4', 'x', 'x')`, [companyAId]);
  });
});
