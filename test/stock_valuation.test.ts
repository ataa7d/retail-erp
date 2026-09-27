import "dotenv/config";
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
let storeAId: string;
let storeBId: string;
let groupId: string;
let variantInGroupId: string;
let variantNoGroupId: string;
let authToken: string;

const PASSWORD = "TestPass123!";

beforeAll(async () => {
  client = newClient();
  await client.connect();
  app = await buildApp();
  await app.ready();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co Valuation', 'شركة') RETURNING id`,
    [`TEST_VAL_${randomUUID().slice(0, 8)}`],
  );
  companyId = company.rows[0].id;

  const branch = await client.query(
    `INSERT INTO branches (company_id, branch_code, name_en, name_ar) VALUES ($1, 'HQ', 'HQ', 'المقر') RETURNING id`,
    [companyId],
  );
  const storeA = await client.query(
    `INSERT INTO stores (company_id, branch_id, store_code, name_en, name_ar) VALUES ($1, $2, 'SA', 'Store A', 'متجر أ') RETURNING id`,
    [companyId, branch.rows[0].id],
  );
  storeAId = storeA.rows[0].id;
  const storeB = await client.query(
    `INSERT INTO stores (company_id, branch_id, store_code, name_en, name_ar) VALUES ($1, $2, 'SB', 'Store B', 'متجر ب') RETURNING id`,
    [companyId, branch.rows[0].id],
  );
  storeBId = storeB.rows[0].id;

  const group = await client.query(
    `INSERT INTO item_groups (company_id, code, name_en, name_ar) VALUES ($1, 'PODIUM', 'Podium', 'بوديوم') RETURNING id`,
    [companyId],
  );
  groupId = group.rows[0].id;

  const itemA = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar, group_id) VALUES ($1, 'IT-A', 'Grouped Item', 'صنف', $2) RETURNING id`,
    [companyId, groupId],
  );
  const variantA = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, 'SKU-A') RETURNING id`,
    [companyId, itemA.rows[0].id],
  );
  variantInGroupId = variantA.rows[0].id;

  const itemB = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, 'IT-B', 'Ungrouped Item', 'صنف') RETURNING id`,
    [companyId],
  );
  const variantB = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, 'SKU-B') RETURNING id`,
    [companyId, itemB.rows[0].id],
  );
  variantNoGroupId = variantB.rows[0].id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Valuation User', 'مستخدم') RETURNING id, email`,
    [`valuser_${randomUUID()}@test.local`, passwordHash],
  );
  const userId = user.rows[0].id;

  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [userId, companyId]);
  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Reports') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = 'accounting.reports.view'`,
    [role.rows[0].id],
  );
  await client.query(`INSERT INTO user_roles (user_id, company_id, role_id) VALUES ($1, $2, $3)`, [userId, companyId, role.rows[0].id]);

  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: user.rows[0].email, password: PASSWORD } });
  authToken = loginRes.json().token;

  // Store A: grouped item, 10 units @ 12.00 = 120.00; ungrouped item, 5 units @ 8.00 = 40.00.
  await recordStockMovement(client, { companyId, storeId: storeAId, itemVariantId: variantInGroupId, movementType: "receipt", qty: 10, explicitUnitCost: 12, sourceType: "test", createdBy: userId });
  await recordStockMovement(client, { companyId, storeId: storeAId, itemVariantId: variantNoGroupId, movementType: "receipt", qty: 5, explicitUnitCost: 8, sourceType: "test", createdBy: userId });
  // Store B: grouped item, 3 units @ 20.00 = 60.00.
  await recordStockMovement(client, { companyId, storeId: storeBId, itemVariantId: variantInGroupId, movementType: "receipt", qty: 3, explicitUnitCost: 20, sourceType: "test", createdBy: userId });
  // A zero-balance row (received then fully issued) should never appear in the report.
  await recordStockMovement(client, { companyId, storeId: storeBId, itemVariantId: variantNoGroupId, movementType: "receipt", qty: 4, explicitUnitCost: 5, sourceType: "test", createdBy: userId });
  await recordStockMovement(client, { companyId, storeId: storeBId, itemVariantId: variantNoGroupId, movementType: "issue", qty: -4, sourceType: "test", createdBy: userId });
});

afterAll(async () => {
  await app.close();
  await client.query(`SET app.bypass_immutability = 'true'`);
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_movements WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_balances WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_variants WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM items WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_groups WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE email LIKE 'valuser_%'`);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

function get(query: string) {
  return app.inject({
    method: "GET",
    url: `/api/reports/stock-valuation?${query}`,
    headers: { Authorization: `Bearer ${authToken}`, "X-Company-Id": companyId },
  });
}

describe("GET /reports/stock-valuation", () => {
  it("lists every non-zero balance with its total value, excluding zeroed-out rows", async () => {
    const res = await get("");
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.rows).toHaveLength(3); // not the 4th, fully-issued row
    expect(Number(body.totalValue)).toBe(220); // 120 + 40 + 60
    const skuA_storeA = body.rows.find((r: { item_variant_id: string; store_id: string }) => r.item_variant_id === variantInGroupId && r.store_id === storeAId);
    expect(Number(skuA_storeA.qty_on_hand)).toBe(10);
    expect(Number(skuA_storeA.avg_unit_cost)).toBe(12);
    expect(Number(skuA_storeA.total_value)).toBe(120);
  });

  it("filters by store", async () => {
    const res = await get(`storeId=${storeBId}`);
    const body = res.json();
    expect(body.rows).toHaveLength(1);
    expect(Number(body.totalValue)).toBe(60);
  });

  it("filters by item group", async () => {
    const res = await get(`groupId=${groupId}`);
    const body = res.json();
    expect(body.rows).toHaveLength(2); // the grouped item in both stores
    expect(Number(body.totalValue)).toBe(180); // 120 + 60
  });

  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/api/reports/stock-valuation" });
    expect(res.statusCode).toBe(401);
  });
});
