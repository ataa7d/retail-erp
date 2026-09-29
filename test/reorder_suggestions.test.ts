import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import type { FastifyInstance } from "fastify";
import { newClient } from "./helpers.js";
import { buildApp } from "../src/api/app.js";
import { recordStockMovement } from "../src/inventory/inventoryService.js";

let client: Client;
let app: FastifyInstance;
let companyId: string;
let storeId: string;
let otherStoreId: string;
let cheapSupplierId: string;
let expensiveSupplierId: string;
let noPriceVariantId: string;
let authToken: string;

const PASSWORD = "TestPass123!";

beforeAll(async () => {
  client = newClient();
  await client.connect();
  app = await buildApp();
  await app.ready();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co Reorder', 'شركة') RETURNING id`,
    [`TEST_REORDER_${randomUUID().slice(0, 8)}`],
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
  const otherStore = await client.query(
    `INSERT INTO stores (company_id, branch_id, store_code, name_en, name_ar) VALUES ($1, $2, 'S2', 'Store 2', 'متجر 2') RETURNING id`,
    [companyId, branch.rows[0].id],
  );
  otherStoreId = otherStore.rows[0].id;

  const cheapSupplier = await client.query(
    `INSERT INTO suppliers (company_id, supplier_code, name_en, name_ar, currency) VALUES ($1, 'SUP1', 'Cheap Supplier', 'مورد رخيص', 'SAR') RETURNING id`,
    [companyId],
  );
  cheapSupplierId = cheapSupplier.rows[0].id;
  const expensiveSupplier = await client.query(
    `INSERT INTO suppliers (company_id, supplier_code, name_en, name_ar, currency) VALUES ($1, 'SUP2', 'Pricey Supplier', 'مورد غالي', 'SAR') RETURNING id`,
    [companyId],
  );
  expensiveSupplierId = expensiveSupplier.rows[0].id;

  const item = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, 'IT-REORDER', 'Reorder Item', 'صنف') RETURNING id`,
    [companyId],
  );
  const variant = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code, reorder_point) VALUES ($1, $2, 'SKU-REORDER', 20) RETURNING id`,
    [companyId, item.rows[0].id],
  );
  const lowVariantId: string = variant.rows[0].id;

  const item2 = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, 'IT-NOPRICE', 'No Price Item', 'صنف بلا سعر') RETURNING id`,
    [companyId],
  );
  const variant2 = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code, reorder_point) VALUES ($1, $2, 'SKU-NOPRICE', 5) RETURNING id`,
    [companyId, item2.rows[0].id],
  );
  noPriceVariantId = variant2.rows[0].id;

  await client.query(
    `INSERT INTO supplier_item_prices (company_id, supplier_id, item_variant_id, unit_cost, currency) VALUES ($1, $2, $3, 10, 'SAR')`,
    [companyId, cheapSupplierId, lowVariantId],
  );
  await client.query(
    `INSERT INTO supplier_item_prices (company_id, supplier_id, item_variant_id, unit_cost, currency) VALUES ($1, $2, $3, 25, 'SAR')`,
    [companyId, expensiveSupplierId, lowVariantId],
  );

  // 5 on hand at storeId (below the 20 reorder point), 100 at otherStoreId (well above it) --
  // the endpoint must scope to the requested store, not sum across all of them.
  await recordStockMovement(client, {
    companyId, storeId, itemVariantId: lowVariantId, movementType: "adjustment_in", qty: 5,
    explicitUnitCost: 10, reasonCode: "test_setup", sourceType: "test",
  });
  await recordStockMovement(client, {
    companyId, storeId: otherStoreId, itemVariantId: lowVariantId, movementType: "adjustment_in", qty: 100,
    explicitUnitCost: 10, reasonCode: "test_setup", sourceType: "test",
  });

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Reorder User', 'مستخدم') RETURNING id, email`,
    [`reorderuser_${randomUUID()}@test.local`, passwordHash],
  );
  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [user.rows[0].id, companyId]);

  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: user.rows[0].email, password: PASSWORD } });
  authToken = loginRes.json().token;
});

afterAll(async () => {
  await app.close();
  await client.query(`SET app.bypass_immutability = 'true'`);
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_movements WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_balances WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM supplier_item_prices WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_variants WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM items WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM suppliers WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE email LIKE 'reorderuser_%'`);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("GET /reorder-suggestions", () => {
  it("picks the cheapest active supplier and computes qty to reach the reorder point, scoped to the requested store", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/reorder-suggestions?storeId=${storeId}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json();

    const low = rows.find((r: { variant_code: string }) => r.variant_code === "SKU-REORDER");
    expect(low).toBeTruthy();
    expect(Number(low.qty_on_hand)).toBe(5);
    expect(low.supplier_id).toBe(cheapSupplierId);
    expect(Number(low.unit_cost)).toBe(10);
    expect(Number(low.suggested_qty)).toBe(15); // 20 - 5

    const noPrice = rows.find((r: { variant_code: string }) => r.variant_code === "SKU-NOPRICE");
    expect(noPrice).toBeTruthy();
    expect(noPrice.supplier_id).toBeNull();
  });

  it("does not flag the item as low stock at a store where it's well stocked", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/reorder-suggestions?storeId=${otherStoreId}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows.find((r: { variant_code: string }) => r.variant_code === "SKU-REORDER")).toBeUndefined();
  });

  it("404s for a store from another company", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/reorder-suggestions?storeId=${randomUUID()}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(404);
  });
});
