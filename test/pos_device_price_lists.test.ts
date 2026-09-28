import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import type { FastifyInstance } from "fastify";
import { newClient } from "./helpers.js";
import { buildApp } from "../src/api/app.js";
import { registerPosDevice } from "../src/sync/posDeviceService.js";

let client: Client;
let app: FastifyInstance;
let companyId: string;
let storeId: string;
let deviceId: string;
let priceListAId: string;
let priceListBId: string;
let userId: string;
let authToken: string;

const PASSWORD = "TestPass123!";

beforeAll(async () => {
  client = newClient();
  await client.connect();
  app = await buildApp();
  await app.ready();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co DevicePL', 'شركة') RETURNING id`,
    [`TEST_DVPL_${randomUUID().slice(0, 8)}`],
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

  const plA = await client.query(
    `INSERT INTO price_lists (company_id, code, name_en, name_ar, price_includes_vat) VALUES ($1, 'PLA', 'List A', 'x', true) RETURNING id`,
    [companyId],
  );
  priceListAId = plA.rows[0].id;
  const plB = await client.query(
    `INSERT INTO price_lists (company_id, code, name_en, name_ar, price_includes_vat) VALUES ($1, 'PLB', 'List B', 'x', true) RETURNING id`,
    [companyId],
  );
  priceListBId = plB.rows[0].id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'DevicePL User', 'مستخدم') RETURNING id, email`,
    [`dvpluser_${randomUUID()}@test.local`, passwordHash],
  );
  userId = user.rows[0].id;

  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [userId, companyId]);
  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Ops') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = 'sales.pos_device.manage'`,
    [role.rows[0].id],
  );
  await client.query(`INSERT INTO user_roles (user_id, company_id, role_id) VALUES ($1, $2, $3)`, [userId, companyId, role.rows[0].id]);

  deviceId = await registerPosDevice(client, {
    companyId,
    storeId,
    deviceCode: "DEV1",
    deviceName: "Test Register",
    seriesPrefix: "TESTDVPL-",
    createdBy: userId,
  });

  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: user.rows[0].email, password: PASSWORD } });
  authToken = loginRes.json().token;
});

afterAll(async () => {
  await app.close();
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM pos_device_sequences WHERE device_id = $1`, [deviceId]);
  await client.query(`DELETE FROM pos_devices WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE email LIKE 'dvpluser_%'`);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM price_lists WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("POS device / store price list assignment", () => {
  it("sets and clears a device's price list override", async () => {
    const set = await app.inject({
      method: "POST",
      url: `/api/pos-devices/${deviceId}/price-list`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { priceListId: priceListAId },
    });
    expect(set.statusCode).toBe(200);

    const row = await client.query(`SELECT price_list_id FROM pos_devices WHERE id = $1`, [deviceId]);
    expect(row.rows[0].price_list_id).toBe(priceListAId);

    const cleared = await app.inject({
      method: "POST",
      url: `/api/pos-devices/${deviceId}/price-list`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { priceListId: null },
    });
    expect(cleared.statusCode).toBe(200);
    const rowAfter = await client.query(`SELECT price_list_id FROM pos_devices WHERE id = $1`, [deviceId]);
    expect(rowAfter.rows[0].price_list_id).toBeNull();
  });

  it("sets a store's default price list", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/stores/${storeId}/default-price-list`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { priceListId: priceListBId },
    });
    expect(res.statusCode).toBe(200);
    const row = await client.query(`SELECT default_price_list_id FROM stores WHERE id = $1`, [storeId]);
    expect(row.rows[0].default_price_list_id).toBe(priceListBId);
  });

  it("rejects a price list from a different company", async () => {
    const otherCompany = await client.query(
      `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Other Co', 'x') RETURNING id`,
      [`TEST_DVPL_OTHER_${randomUUID().slice(0, 8)}`],
    );
    const otherList = await client.query(
      `INSERT INTO price_lists (company_id, code, name_en, name_ar, price_includes_vat) VALUES ($1, 'OTH', 'Other', 'x', true) RETURNING id`,
      [otherCompany.rows[0].id],
    );
    const res = await app.inject({
      method: "POST",
      url: `/api/pos-devices/${deviceId}/price-list`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { priceListId: otherList.rows[0].id },
    });
    expect(res.statusCode).toBe(404);

    await client.query(`DELETE FROM price_lists WHERE company_id = $1`, [otherCompany.rows[0].id]);
    await client.query(`DELETE FROM companies WHERE id = $1`, [otherCompany.rows[0].id]);
  });
});
