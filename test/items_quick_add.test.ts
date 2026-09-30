import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import type { FastifyInstance } from "fastify";
import { newClient } from "./helpers.js";
import { buildApp } from "../src/api/app.js";

let client: Client;
let app: FastifyInstance;
let companyId: string;
let userId: string;
let authToken: string;
let baseUnitId: string;

const PASSWORD = "TestPass123!";

beforeAll(async () => {
  client = newClient();
  await client.connect();
  app = await buildApp();
  await app.ready();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co QuickAdd', 'شركة') RETURNING id`,
    [`TEST_QADD_${randomUUID().slice(0, 8)}`],
  );
  companyId = company.rows[0].id;

  const unit = await client.query(
    `INSERT INTO units_of_measure (company_id, code, name_en, name_ar) VALUES ($1, 'PC', 'Piece', 'قطعة') RETURNING id`,
    [companyId],
  );
  baseUnitId = unit.rows[0].id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'QA User', 'مستخدم') RETURNING id, email`,
    [`qadduser_${randomUUID()}@test.local`, passwordHash],
  );
  userId = user.rows[0].id;

  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [userId, companyId]);
  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Inventory Manager') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = 'inventory.items.manage'`,
    [role.rows[0].id],
  );
  await client.query(`INSERT INTO user_roles (user_id, company_id, role_id) VALUES ($1, $2, $3)`, [userId, companyId, role.rows[0].id]);

  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: user.rows[0].email, password: PASSWORD } });
  authToken = loginRes.json().token;
});

afterAll(async () => {
  await app.close();
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_barcodes WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_units WHERE item_id IN (SELECT id FROM items WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM item_variants WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM items WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE email LIKE 'qadduser_%'`);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM units_of_measure WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("POST /items/quick-add", () => {
  it("creates a new item, variant, and an auto-generated primary barcode", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/items/quick-add",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: {
        itemCode: "QA-001",
        nameEn: "Quick Add Item",
        nameAr: "صنف سريع",
        baseUnitOfMeasureId: baseUnitId,
        variantCode: "QA-001-V1",
        standardCost: 12.5,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.internalBarcode).toMatch(/^20\d{11}$/);

    const barcode = await client.query(`SELECT barcode, is_primary FROM item_barcodes WHERE item_variant_id = $1`, [body.variantId]);
    expect(barcode.rows).toHaveLength(1);
    expect(barcode.rows[0].barcode).toBe(body.internalBarcode);
    expect(barcode.rows[0].is_primary).toBe(true);
  });

  it("adds a second variant to an item that already exists rather than duplicating it", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/items/quick-add",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: {
        itemCode: "QA-002",
        nameEn: "Two Variant Item",
        nameAr: "صنف بمتغيرين",
        baseUnitOfMeasureId: baseUnitId,
        variantCode: "QA-002-V1",
      },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/items/quick-add",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: {
        itemCode: "QA-002",
        nameEn: "Two Variant Item",
        nameAr: "صنف بمتغيرين",
        baseUnitOfMeasureId: baseUnitId,
        variantCode: "QA-002-V2",
      },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().itemId).toBe(first.json().itemId);
    expect(second.json().variantId).not.toBe(first.json().variantId);

    const items = await client.query(`SELECT id FROM items WHERE company_id = $1 AND item_code = 'QA-002'`, [companyId]);
    expect(items.rows).toHaveLength(1);
  });

  it("rejects a duplicate variant code", async () => {
    await app.inject({
      method: "POST",
      url: "/api/items/quick-add",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: {
        itemCode: "QA-003",
        nameEn: "Dup Item",
        nameAr: "صنف مكرر",
        baseUnitOfMeasureId: baseUnitId,
        variantCode: "QA-003-V1",
      },
    });
    const dup = await app.inject({
      method: "POST",
      url: "/api/items/quick-add",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: {
        itemCode: "QA-004",
        nameEn: "Another Item",
        nameAr: "صنف آخر",
        baseUnitOfMeasureId: baseUnitId,
        variantCode: "QA-003-V1",
      },
    });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().error).toMatch(/already exists/);
  });

  it("auto-generates an item code when none is supplied", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/items/quick-add",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: {
        nameEn: "Auto Code Item",
        nameAr: "صنف برمز تلقائي",
        baseUnitOfMeasureId: baseUnitId,
        variantCode: "QA-AUTO-V1",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.itemCode).toMatch(/^ITM-\d{6}$/);

    const item = await client.query(`SELECT item_code FROM items WHERE id = $1`, [body.itemId]);
    expect(item.rows[0].item_code).toBe(body.itemCode);
  });
});
