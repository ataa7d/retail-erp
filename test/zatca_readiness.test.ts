import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Client } from "pg";
import { newClient } from "./helpers.js";
import { buildApp } from "../src/api/app.js";
import { runZatcaReadinessCheck } from "../src/zatca/readinessCheck.js";

let app: FastifyInstance;
let client: Client;
let companyId: string;
let storeId: string;
let periodId: string;
let itemVariantId: string;
let authToken: string;

const PASSWORD = "TestPass123!";

function statusOf(report: Awaited<ReturnType<typeof runZatcaReadinessCheck>>, id: string) {
  return report.checks.find((c) => c.id === id)?.status;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  client = newClient();
  await client.connect();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar, vat_registration_number, cr_number)
     VALUES ($1, 'Test Co Readiness', 'شركة', '300000000000003', '1010101010') RETURNING id`,
    [`TEST_READY_${randomUUID().slice(0, 8)}`],
  );
  companyId = company.rows[0].id;

  const branch = await client.query(
    `INSERT INTO branches (company_id, branch_code, name_en, name_ar, address, city)
     VALUES ($1, 'HQ', 'HQ', 'المقر', 'King Fahd Road', 'Riyadh') RETURNING id`,
    [companyId],
  );
  const store = await client.query(
    `INSERT INTO stores (company_id, branch_id, store_code, name_en, name_ar) VALUES ($1, $2, 'ST1', 'Store 1', 'متجر 1') RETURNING id`,
    [companyId, branch.rows[0].id],
  );
  storeId = store.rows[0].id;

  const fy = await client.query(
    `INSERT INTO fiscal_years (company_id, year_name, start_date, end_date) VALUES ($1, 'FY2026', '2026-01-01', '2026-12-31') RETURNING id`,
    [companyId],
  );
  const period = await client.query(
    `INSERT INTO fiscal_periods (fiscal_year_id, company_id, period_number, start_date, end_date, status)
     VALUES ($1, $2, 3, '2026-03-01', '2026-03-31', 'open') RETURNING id`,
    [fy.rows[0].id, companyId],
  );
  periodId = period.rows[0].id;

  const groups: Array<[string, string, string]> = [
    ["1000", "asset", "debit"],
    ["2000", "liability", "credit"],
    ["4000", "revenue", "credit"],
    ["5000", "expense", "debit"],
  ];
  const groupIds: Record<string, string> = {};
  for (const [code, type, bal] of groups) {
    const r = await client.query(
      `INSERT INTO chart_of_accounts (company_id, account_code, name_en, name_ar, account_type, normal_balance, is_header)
       VALUES ($1, $2, $2, $2, $3, $4, true) RETURNING id`,
      [companyId, code, type, bal],
    );
    groupIds[code] = r.rows[0].id;
  }
  const leaves: Array<[string, string, string, string]> = [
    ["1110", "asset", "debit", "1000"],
    ["1120", "asset", "debit", "1000"],
    ["1130", "asset", "debit", "1000"],
    ["2110", "liability", "credit", "2000"],
    ["4110", "revenue", "credit", "4000"],
    ["4120", "revenue", "debit", "4000"],
    ["5100", "expense", "debit", "5000"],
  ];
  for (const [code, type, bal, parent] of leaves) {
    await client.query(
      `INSERT INTO chart_of_accounts (company_id, parent_id, account_code, name_en, name_ar, account_type, normal_balance)
       VALUES ($1, $2, $3, $3, $3, $4, $5)`,
      [companyId, groupIds[parent], code, type, bal],
    );
  }

  const taxCode = await client.query(
    `INSERT INTO tax_codes (company_id, code, name_en, name_ar, rate, tax_type) VALUES ($1, 'VAT15', 'Standard VAT', 'ضريبة', 15, 'standard') RETURNING id`,
    [companyId],
  );

  const item = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar, default_tax_code_id) VALUES ($1, 'IT-1', 'Item', 'صنف', $2) RETURNING id`,
    [companyId, taxCode.rows[0].id],
  );
  const variant = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, 'SKU-1') RETURNING id`,
    [companyId, item.rows[0].id],
  );
  itemVariantId = variant.rows[0].id;

  await client.query(
    `INSERT INTO pos_devices (company_id, store_id, device_code, device_name, series_prefix, status) VALUES ($1, $2, 'POS1', 'POS 1', 'RDY-POS1-', 'active')`,
    [companyId, storeId],
  );

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Readiness Test User', 'مستخدم') RETURNING id`,
    [`readyuser_${randomUUID()}@test.local`, passwordHash],
  );
  const userId = user.rows[0].id;
  const userEmail = (await client.query(`SELECT email FROM users WHERE id = $1`, [userId])).rows[0].email;

  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [userId, companyId]);
  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Full Access') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = 'sales.pos_invoice.create'`,
    [role.rows[0].id],
  );
  await client.query(`INSERT INTO user_roles (user_id, company_id, role_id) VALUES ($1, $2, $3)`, [userId, companyId, role.rows[0].id]);

  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: userEmail, password: PASSWORD } });
  authToken = loginRes.json().token;
});

afterAll(async () => {
  await app.close();
  await client.query(`SET app.bypass_immutability = 'true'`);
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoice_payments WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoice_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoices WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journal_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journals WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_movements WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_balances WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM pos_devices WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_variants WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM items WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM tax_codes WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM chart_of_accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

async function createAndPostInvoice() {
  const created = await app.inject({
    method: "POST",
    url: "/api/sales-invoices",
    headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    payload: {
      storeId,
      invoiceChannel: "pos",
      zatcaInvoiceCategory: "simplified",
      invoiceDate: "2026-03-15",
      fiscalPeriodId: periodId,
      lines: [{ itemVariantId, itemDescription: "Item", qty: 1, unitPrice: 115, discountAmount: 0, vatRate: 15, priceIncludesVat: true }],
      payments: [{ paymentMethod: "cash", amount: 115 }],
    },
  });
  const invoiceId = created.json().id;
  const posted = await app.inject({
    method: "POST",
    url: `/api/sales-invoices/${invoiceId}/post`,
    headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
  });
  expect(posted.statusCode).toBe(200);
  return invoiceId;
}

describe("ZATCA production go-live readiness check", () => {
  it("a company with no ZATCA onboarding at all is not ready, and reports specific missing pieces", async () => {
    const report = await runZatcaReadinessCheck(client, companyId);
    expect(report.ready).toBe(false);
    expect(statusOf(report, "vat_number")).toBe("pass");
    expect(statusOf(report, "cr_number")).toBe("pass");
    expect(statusOf(report, "base_currency")).toBe("pass");
    expect(statusOf(report, "branch_addresses")).toBe("pass");
    expect(statusOf(report, "tax_codes")).toBe("pass");
    expect(statusOf(report, "items_tax_codes")).toBe("pass");
    expect(statusOf(report, "open_period")).toBe("pass");
    expect(statusOf(report, "pos_devices")).toBe("pass");
    expect(statusOf(report, "onboarding_status")).toBe("fail");
    expect(statusOf(report, "compliance_coverage")).toBe("fail");
  });

  it("an invalid VAT number fails the vat_number check", async () => {
    await client.query(`UPDATE companies SET vat_registration_number = '123' WHERE id = $1`, [companyId]);
    const report = await runZatcaReadinessCheck(client, companyId);
    expect(statusOf(report, "vat_number")).toBe("fail");
    await client.query(`UPDATE companies SET vat_registration_number = '300000000000003' WHERE id = $1`, [companyId]);
  });

  it("an unbroken hash chain across two posted invoices passes, and no posted document is missing its XML hash", async () => {
    await createAndPostInvoice();
    await createAndPostInvoice();
    const report = await runZatcaReadinessCheck(client, companyId);
    expect(statusOf(report, "hash_chain")).toBe("pass");
    expect(statusOf(report, "xml_coverage")).toBe("pass");
  });

  it("detects a broken hash chain (tampered previous-hash on a posted document)", async () => {
    const firstId = await createAndPostInvoice();
    const secondId = await createAndPostInvoice();
    void firstId;

    await client.query(`SET app.bypass_immutability = 'true'`);
    await client.query(`UPDATE sales_invoices SET xml_previous_invoice_hash = 'tampered-not-a-real-hash==' WHERE id = $1`, [secondId]);
    await client.query(`SET app.bypass_immutability = 'false'`);

    const report = await runZatcaReadinessCheck(client, companyId);
    const chain = report.checks.find((c) => c.id === "hash_chain")!;
    expect(chain.status).toBe("fail");
    expect(chain.detail).toContain("Chain break");
    expect(report.ready).toBe(false);
  });

  it("GET /api/zatca-onboarding/readiness returns the same report shape over HTTP", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/zatca-onboarding/readiness",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.ready).toBe("boolean");
    expect(Array.isArray(body.checks)).toBe(true);
    expect(body.checks.some((c: { id: string }) => c.id === "hash_chain")).toBe(true);
  });
});
