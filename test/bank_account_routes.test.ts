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
let glAccountId: string;
let bankAccountId: string;
let authToken: string;

const PASSWORD = "TestPass123!";

beforeAll(async () => {
  client = newClient();
  await client.connect();
  app = await buildApp();
  await app.ready();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co Bank Routes', 'شركة') RETURNING id`,
    [`TEST_BANKRT_${randomUUID().slice(0, 8)}`],
  );
  companyId = company.rows[0].id;

  const header = await client.query(
    `INSERT INTO chart_of_accounts (company_id, account_code, name_en, name_ar, account_type, normal_balance, is_header)
     VALUES ($1, '1000', 'Assets', 'x', 'asset', 'debit', true) RETURNING id`,
    [companyId],
  );
  const leaf = await client.query(
    `INSERT INTO chart_of_accounts (company_id, parent_id, account_code, name_en, name_ar, account_type, normal_balance)
     VALUES ($1, $2, '1110', 'Cash', 'x', 'asset', 'debit') RETURNING id`,
    [companyId, header.rows[0].id],
  );
  glAccountId = leaf.rows[0].id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Bank Route User', 'مستخدم') RETURNING id, email`,
    [`bankrouteuser_${randomUUID()}@test.local`, passwordHash],
  );
  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [user.rows[0].id, companyId]);
  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Finance') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = 'accounting.coa.manage'`,
    [role.rows[0].id],
  );
  await client.query(`INSERT INTO user_roles (user_id, company_id, role_id) VALUES ($1, $2, $3)`, [user.rows[0].id, companyId, role.rows[0].id]);

  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: user.rows[0].email, password: PASSWORD } });
  authToken = loginRes.json().token;
});

afterAll(async () => {
  await app.close();
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM bank_accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE email LIKE 'bankrouteuser_%'`);
  await client.query(`DELETE FROM chart_of_accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("bank accounts", () => {
  it("creates a bank account linked to a GL account", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/bank-accounts",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { bankName: "Test Bank", accountName: "Main Account", accountNumber: "12345", currency: "SAR", glAccountId },
    });
    expect(res.statusCode).toBe(201);
    bankAccountId = res.json().id;

    const row = await client.query(`SELECT gl_account_id, currency FROM bank_accounts WHERE id = $1`, [bankAccountId]);
    expect(row.rows[0].gl_account_id).toBe(glAccountId);
    expect(row.rows[0].currency).toBe("SAR");
  });

  it("rejects creating a second bank account on the same GL account", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/bank-accounts",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { bankName: "Duplicate Bank", accountName: "Another Account", currency: "SAR", glAccountId },
    });
    expect(res.statusCode).toBe(409);
  });

  it("updates name/contact details and can deactivate, without touching the GL account or currency", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/bank-accounts/${bankAccountId}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { bankName: "Renamed Bank", accountName: "Renamed Account", accountNumber: "99999", isActive: false },
    });
    expect(res.statusCode).toBe(200);

    const row = await client.query(`SELECT bank_name, is_active, gl_account_id, currency FROM bank_accounts WHERE id = $1`, [bankAccountId]);
    expect(row.rows[0].bank_name).toBe("Renamed Bank");
    expect(row.rows[0].is_active).toBe(false);
    expect(row.rows[0].gl_account_id).toBe(glAccountId);
    expect(row.rows[0].currency).toBe("SAR");
  });

  it("404s creating a bank account against a GL account from another company", async () => {
    const otherCompany = await client.query(
      `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Other', 'x') RETURNING id`,
      [`TEST_BANKRT_OTHER_${randomUUID().slice(0, 8)}`],
    );
    const otherAccount = await client.query(
      `INSERT INTO chart_of_accounts (company_id, account_code, name_en, name_ar, account_type, normal_balance)
       VALUES ($1, '1110', 'Cash', 'x', 'asset', 'debit') RETURNING id`,
      [otherCompany.rows[0].id],
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/bank-accounts",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { bankName: "x", accountName: "x", currency: "SAR", glAccountId: otherAccount.rows[0].id },
    });
    expect(res.statusCode).toBe(404);

    await client.query(`DELETE FROM chart_of_accounts WHERE company_id = $1`, [otherCompany.rows[0].id]);
    await client.query(`DELETE FROM companies WHERE id = $1`, [otherCompany.rows[0].id]);
  });
});
