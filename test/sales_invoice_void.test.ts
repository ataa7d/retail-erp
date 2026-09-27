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
let storeId: string;
let customerId: string;
let periodId: string;
let itemVariantId: string;
let authToken: string;

const PASSWORD = "TestPass123!";

async function inject(method: "GET" | "POST", url: string, body?: Record<string, unknown>) {
  return app.inject({
    method,
    url,
    headers: { Authorization: `Bearer ${authToken}`, "X-Company-Id": companyId },
    payload: body,
  });
}

async function postedInvoice(unitPrice: number) {
  const create = await inject("POST", "/api/sales-invoices", {
    storeId,
    invoiceChannel: "pos",
    zatcaInvoiceCategory: "simplified",
    invoiceDate: "2026-03-10",
    fiscalPeriodId: periodId,
    customerId,
    lines: [{ itemVariantId, itemDescription: "Item", qty: 1, unitPrice, discountAmount: 0, vatRate: 0, priceIncludesVat: true }],
    payments: [{ paymentMethod: "cash", amount: unitPrice }],
  });
  const invoiceId = create.json().id;
  await inject("POST", `/api/sales-invoices/${invoiceId}/post`);
  return invoiceId;
}

beforeAll(async () => {
  client = newClient();
  await client.connect();
  app = await buildApp();
  await app.ready();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co Void', 'شركة') RETURNING id`,
    [`TEST_VOID_${randomUUID().slice(0, 8)}`],
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

  const customer = await client.query(
    `INSERT INTO customers (company_id, customer_code, name_en, name_ar) VALUES ($1, 'C1', 'Walk-in', 'نقدي') RETURNING id`,
    [companyId],
  );
  customerId = customer.rows[0].id;

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
    ["4000", "revenue", "credit"],
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
    ["2110", "liability", "credit", "1000"],
    ["4110", "revenue", "credit", "4000"],
    ["4120", "revenue", "debit", "4000"],
  ];
  for (const [code, type, bal, parent] of leaves) {
    await client.query(
      `INSERT INTO chart_of_accounts (company_id, parent_id, account_code, name_en, name_ar, account_type, normal_balance)
       VALUES ($1, $2, $3, $3, $3, $4, $5)`,
      [companyId, groupIds[parent], code, type, bal],
    );
  }

  const item = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, 'IT-VOID', 'Void Item', 'صنف') RETURNING id`,
    [companyId],
  );
  const variant = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, 'SKU-VOID') RETURNING id`,
    [companyId, item.rows[0].id],
  );
  itemVariantId = variant.rows[0].id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Void User', 'مستخدم') RETURNING id, email`,
    [`voiduser_${randomUUID()}@test.local`, passwordHash],
  );
  const userId = user.rows[0].id;

  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [userId, companyId]);
  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Cashier Manager') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions WHERE code IN ('sales.pos_invoice.create', 'sales.document.void')`,
    [role.rows[0].id],
  );
  await client.query(`INSERT INTO user_roles (user_id, company_id, role_id) VALUES ($1, $2, $3)`, [userId, companyId, role.rows[0].id]);

  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: user.rows[0].email, password: PASSWORD } });
  authToken = loginRes.json().token;
});

afterAll(async () => {
  await app.close();
  await client.query(`SET app.bypass_immutability = 'true'`);
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM credit_note_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM credit_notes WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoice_payments WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoice_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoices WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journal_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journals WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_movements WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_balances WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_variants WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM items WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM customers WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM chart_of_accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE email LIKE 'voiduser_%'`);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("POST /sales-invoices/:id/void", () => {
  it("issues and posts a full credit note, and the invoice shows as fully credited afterward", async () => {
    const invoiceId = await postedInvoice(100);

    const voidRes = await inject("POST", `/api/sales-invoices/${invoiceId}/void`, { fiscalPeriodId: periodId, reason: "wrong item rung up" });
    expect(voidRes.statusCode).toBe(201);
    const { creditNoteId } = voidRes.json();
    expect(voidRes.json().status).toBe("posted");

    const cn = await inject("GET", `/api/credit-notes/${creditNoteId}`);
    expect(cn.statusCode).toBe(200);
    expect(cn.json().document_status).toBe("posted");
    expect(Number(cn.json().gross_amount)).toBe(100);
    expect(cn.json().reason).toBe("Voided: wrong item rung up");

    const detail = await inject("GET", `/api/sales-invoices/${invoiceId}`);
    expect(Number(detail.json().creditedAmount)).toBe(100);

    const list = await inject("GET", "/api/sales-invoices");
    const row = list.json().find((r: { id: string }) => r.id === invoiceId);
    expect(Number(row.credited_amount)).toBe(100);
  });

  it("rejects voiding an invoice that already has a credit note against it", async () => {
    const invoiceId = await postedInvoice(50);
    await inject("POST", `/api/sales-invoices/${invoiceId}/void`, { fiscalPeriodId: periodId, reason: "first void" });

    const second = await inject("POST", `/api/sales-invoices/${invoiceId}/void`, { fiscalPeriodId: periodId, reason: "second void" });
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toMatch(/already has a credit note/);
  });

  it("rejects voiding a draft (unposted) invoice", async () => {
    const create = await inject("POST", "/api/sales-invoices", {
      storeId,
      invoiceChannel: "pos",
      zatcaInvoiceCategory: "simplified",
      invoiceDate: "2026-03-10",
      fiscalPeriodId: periodId,
      customerId,
      lines: [{ itemVariantId, itemDescription: "Item", qty: 1, unitPrice: 10, discountAmount: 0, vatRate: 0, priceIncludesVat: true }],
      payments: [{ paymentMethod: "cash", amount: 10 }],
    });
    const res = await inject("POST", `/api/sales-invoices/${create.json().id}/void`, { fiscalPeriodId: periodId, reason: "test" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/only a posted invoice/);
  });

  it("rejects an unauthenticated request", async () => {
    const invoiceId = await postedInvoice(20);
    const res = await app.inject({ method: "POST", url: `/api/sales-invoices/${invoiceId}/void`, payload: { fiscalPeriodId: periodId, reason: "x" } });
    expect(res.statusCode).toBe(401);
  });
});
