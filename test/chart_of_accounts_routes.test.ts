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
let headerAccountId: string;
let authToken: string;
let noPermToken: string;

const PASSWORD = "TestPass123!";

beforeAll(async () => {
  client = newClient();
  await client.connect();
  app = await buildApp();
  await app.ready();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co COA', 'شركة') RETURNING id`,
    [`TEST_COA_${randomUUID().slice(0, 8)}`],
  );
  companyId = company.rows[0].id;

  const header = await client.query(
    `INSERT INTO chart_of_accounts (company_id, account_code, name_en, name_ar, account_type, normal_balance, is_header)
     VALUES ($1, '1000', 'Assets', 'أصول', 'asset', 'debit', true) RETURNING id`,
    [companyId],
  );
  headerAccountId = header.rows[0].id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'COA User', 'مستخدم') RETURNING id, email`,
    [`coauser_${randomUUID()}@test.local`, passwordHash],
  );
  const noPermUser = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'No Perm', 'مستخدم') RETURNING id, email`,
    [`coanoperm_${randomUUID()}@test.local`, passwordHash],
  );

  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [user.rows[0].id, companyId]);
  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [noPermUser.rows[0].id, companyId]);
  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Finance') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = 'accounting.coa.manage'`,
    [role.rows[0].id],
  );
  await client.query(`INSERT INTO user_roles (user_id, company_id, role_id) VALUES ($1, $2, $3)`, [user.rows[0].id, companyId, role.rows[0].id]);

  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: user.rows[0].email, password: PASSWORD } });
  authToken = loginRes.json().token;
  const noPermLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: noPermUser.rows[0].email, password: PASSWORD } });
  noPermToken = noPermLogin.json().token;
});

afterAll(async () => {
  await app.close();
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM chart_of_accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE email LIKE 'coauser_%' OR email LIKE 'coanoperm_%'`);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("chart of accounts", () => {
  it("creates a leaf account under a header account", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chart-of-accounts",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { accountCode: "1160", nameEn: "Petty Cash", nameAr: "نثرية", accountType: "asset", normalBalance: "debit", parentId: headerAccountId },
    });
    expect(res.statusCode).toBe(201);

    const row = await client.query(`SELECT parent_id, is_header FROM chart_of_accounts WHERE id = $1`, [res.json().id]);
    expect(row.rows[0].parent_id).toBe(headerAccountId);
    expect(row.rows[0].is_header).toBe(false);
  });

  it("rejects creating an account under a parent from another company", async () => {
    const otherCompany = await client.query(
      `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Other', 'x') RETURNING id`,
      [`TEST_COA_OTHER_${randomUUID().slice(0, 8)}`],
    );
    const otherHeader = await client.query(
      `INSERT INTO chart_of_accounts (company_id, account_code, name_en, name_ar, account_type, normal_balance, is_header)
       VALUES ($1, '1000', 'Assets', 'x', 'asset', 'debit', true) RETURNING id`,
      [otherCompany.rows[0].id],
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/chart-of-accounts",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { accountCode: "1170", nameEn: "x", nameAr: "x", accountType: "asset", normalBalance: "debit", parentId: otherHeader.rows[0].id },
    });
    expect(res.statusCode).toBe(404);

    await client.query(`DELETE FROM chart_of_accounts WHERE company_id = $1`, [otherCompany.rows[0].id]);
    await client.query(`DELETE FROM companies WHERE id = $1`, [otherCompany.rows[0].id]);
  });

  it("rejects creating an account without accounting.coa.manage", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chart-of-accounts",
      headers: { authorization: `Bearer ${noPermToken}`, "x-company-id": companyId },
      payload: { accountCode: "9999", nameEn: "x", nameAr: "x", accountType: "asset", normalBalance: "debit" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("updates an account's name and active flag but not its type or code", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/chart-of-accounts",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { accountCode: "1180", nameEn: "Old Name", nameAr: "قديم", accountType: "asset", normalBalance: "debit", parentId: headerAccountId },
    });
    const accountId = created.json().id;

    const updated = await app.inject({
      method: "POST",
      url: `/api/chart-of-accounts/${accountId}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { nameEn: "New Name", nameAr: "جديد", isActive: false },
    });
    expect(updated.statusCode).toBe(200);

    const row = await client.query(`SELECT name_en, is_active, account_code, account_type FROM chart_of_accounts WHERE id = $1`, [accountId]);
    expect(row.rows[0].name_en).toBe("New Name");
    expect(row.rows[0].is_active).toBe(false);
    expect(row.rows[0].account_code).toBe("1180");
    expect(row.rows[0].account_type).toBe("asset");
  });
});
