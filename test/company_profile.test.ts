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
let branchId: string;
let userId: string;
let authToken: string;
let noPermToken: string;

const PASSWORD = "TestPass123!";

beforeAll(async () => {
  client = newClient();
  await client.connect();
  app = await buildApp();
  await app.ready();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co Profile', 'شركة') RETURNING id`,
    [`TEST_PROF_${randomUUID().slice(0, 8)}`],
  );
  companyId = company.rows[0].id;

  const branch = await client.query(
    `INSERT INTO branches (company_id, branch_code, name_en, name_ar) VALUES ($1, 'HQ', 'HQ', 'المقر') RETURNING id`,
    [companyId],
  );
  branchId = branch.rows[0].id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Profile User', 'مستخدم') RETURNING id, email`,
    [`profileuser_${randomUUID()}@test.local`, passwordHash],
  );
  userId = user.rows[0].id;
  const noPermUser = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'No Perm User', 'مستخدم') RETURNING id, email`,
    [`profilenoperm_${randomUUID()}@test.local`, passwordHash],
  );

  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [userId, companyId]);
  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [noPermUser.rows[0].id, companyId]);
  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Ops Admin') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = 'admin.companies.manage'`,
    [role.rows[0].id],
  );
  await client.query(`INSERT INTO user_roles (user_id, company_id, role_id) VALUES ($1, $2, $3)`, [userId, companyId, role.rows[0].id]);

  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: user.rows[0].email, password: PASSWORD } });
  authToken = loginRes.json().token;
  const noPermLoginRes = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: noPermUser.rows[0].email, password: PASSWORD },
  });
  noPermToken = noPermLoginRes.json().token;
});

afterAll(async () => {
  await app.close();
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE email LIKE 'profileuser_%' OR email LIKE 'profilenoperm_%'`);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("company profile", () => {
  it("updates the company's name, VAT number, and address", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/companies/current",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { nameEn: "Renamed Co", nameAr: "شركة معاد تسميتها", crNumber: "9998887776", vatRegistrationNumber: "300111222333444", address: "Olaya St, Riyadh" },
    });
    expect(res.statusCode).toBe(200);

    const row = await client.query(`SELECT name_en, address FROM companies WHERE id = $1`, [companyId]);
    expect(row.rows[0].name_en).toBe("Renamed Co");
    expect(row.rows[0].address).toBe("Olaya St, Riyadh");
  });

  it("rejects updating the company profile without admin.companies.manage", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/companies/current",
      headers: { authorization: `Bearer ${noPermToken}`, "x-company-id": companyId },
      payload: { nameEn: "Hacked Co", nameAr: "x" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("branches", () => {
  it("creates and updates a branch", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/branches",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { branchCode: "BR2", nameEn: "Branch 2", nameAr: "فرع 2", city: "Jeddah" },
    });
    expect(created.statusCode).toBe(201);
    const newBranchId = created.json().id;

    const updated = await app.inject({
      method: "POST",
      url: `/api/branches/${newBranchId}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { nameEn: "Branch Two Renamed", nameAr: "فرع 2 معاد تسميته", city: "Dammam" },
    });
    expect(updated.statusCode).toBe(200);

    const row = await client.query(`SELECT name_en, city FROM branches WHERE id = $1`, [newBranchId]);
    expect(row.rows[0].name_en).toBe("Branch Two Renamed");
    expect(row.rows[0].city).toBe("Dammam");
  });
});

describe("stores", () => {
  it("creates a store under a branch and rejects a branch from another company", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/stores",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { branchId, storeCode: "SX1", nameEn: "Store X1", nameAr: "متجر X1", storeType: "warehouse", city: "Riyadh" },
    });
    expect(created.statusCode).toBe(201);

    const otherCompany = await client.query(
      `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Other', 'x') RETURNING id`,
      [`TEST_PROF_OTHER_${randomUUID().slice(0, 8)}`],
    );
    const otherBranch = await client.query(
      `INSERT INTO branches (company_id, branch_code, name_en, name_ar) VALUES ($1, 'HQ', 'HQ', 'x') RETURNING id`,
      [otherCompany.rows[0].id],
    );
    const rejected = await app.inject({
      method: "POST",
      url: "/api/stores",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { branchId: otherBranch.rows[0].id, storeCode: "SX2", nameEn: "Store X2", nameAr: "متجر X2" },
    });
    expect(rejected.statusCode).toBe(404);

    await client.query(`DELETE FROM branches WHERE company_id = $1`, [otherCompany.rows[0].id]);
    await client.query(`DELETE FROM companies WHERE id = $1`, [otherCompany.rows[0].id]);
  });

  it("updates a store's name and type", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/stores",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { branchId, storeCode: "SX3", nameEn: "Store X3", nameAr: "متجر X3" },
    });
    const storeId = created.json().id;

    const updated = await app.inject({
      method: "POST",
      url: `/api/stores/${storeId}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { branchId, nameEn: "Store X3 Renamed", nameAr: "متجر X3 معاد تسميته", storeType: "kiosk" },
    });
    expect(updated.statusCode).toBe(200);

    const row = await client.query(`SELECT name_en, store_type FROM stores WHERE id = $1`, [storeId]);
    expect(row.rows[0].name_en).toBe("Store X3 Renamed");
    expect(row.rows[0].store_type).toBe("kiosk");
  });
});
