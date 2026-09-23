import "dotenv/config";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Client } from "pg";
import { newClient } from "./helpers.js";
import { buildApp } from "../src/api/app.js";

let app: FastifyInstance;
let client: Client;
let companyId: string;
let storeId: string;
let periodId: string;
let itemVariantId: string;
let customerId: string;
let userId: string;
let otherUserId: string; // has company access but no permissions
let authToken: string;
let noPermToken: string;

const PASSWORD = "TestPass123!";

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  client = newClient();
  await client.connect();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co API', 'شركة') RETURNING id`,
    [`TEST_API_${randomUUID().slice(0, 8)}`],
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
    ["2110", "liability", "credit", "2000"],
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
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, 'IT-1', 'Item', 'صنف') RETURNING id`,
    [companyId],
  );
  const variant = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, 'SKU-1') RETURNING id`,
    [companyId, item.rows[0].id],
  );
  itemVariantId = variant.rows[0].id;

  const customer = await client.query(
    `INSERT INTO customers (company_id, customer_code, name_en, name_ar) VALUES ($1, 'C1', 'Customer 1', 'عميل 1') RETURNING id`,
    [companyId],
  );
  customerId = customer.rows[0].id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'API Test User', 'مستخدم') RETURNING id`,
    [`apiuser_${randomUUID()}@test.local`, passwordHash],
  );
  userId = user.rows[0].id;
  const userEmail = (await client.query(`SELECT email FROM users WHERE id = $1`, [userId])).rows[0].email;

  const otherUser = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'No Perm User', 'مستخدم') RETURNING id`,
    [`noperm_${randomUUID()}@test.local`, passwordHash],
  );
  otherUserId = otherUser.rows[0].id;
  const otherEmail = (await client.query(`SELECT email FROM users WHERE id = $1`, [otherUserId])).rows[0].email;

  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2), ($3, $2)`, [userId, companyId, otherUserId]);

  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Full Access') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code IN ('sales.pos_invoice.create', 'sales.return.create')`,
    [role.rows[0].id],
  );
  await client.query(`INSERT INTO user_roles (user_id, company_id, role_id) VALUES ($1, $2, $3)`, [userId, companyId, role.rows[0].id]);
  // otherUserId gets company access but no role/permissions at all.

  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: userEmail, password: PASSWORD } });
  authToken = loginRes.json().token;

  const noPermLoginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: otherEmail, password: PASSWORD } });
  noPermToken = noPermLoginRes.json().token;
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
  await client.query(`DELETE FROM user_roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE id IN ($1, $2)`, [userId, otherUserId]);
  await client.query(`DELETE FROM item_variants WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM items WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM customers WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM chart_of_accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("health", () => {
  it("responds without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("auth", () => {
  it("rejects a bad password", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/auth/login",
      payload: { email: "apiuser@test.local", password: "wrong" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects requests with no token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects requests with a token but no X-Company-Id header", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/me",
      headers: { authorization: `Bearer ${authToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns the user's roles and permissions for the company", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/me",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.permissions).toContain("sales.pos_invoice.create");
    expect(body.roles).toHaveLength(1);
    expect(body.roles[0]).toMatchObject({ name: "Full Access", store_id: null });
  });

  it("rejects a second company-wide grant of the same role for the same user", async () => {
    // The user_roles unique index treats a NULL store_id as a single value
    // (uq_user_roles_company_wide), so re-granting the same company-wide
    // role is a constraint violation rather than a silent duplicate row.
    const roleRow = await client.query(`SELECT id FROM roles WHERE company_id = $1 AND name = 'Full Access'`, [companyId]);
    const roleId = roleRow.rows[0].id;
    await expect(
      client.query(
        `INSERT INTO user_roles (user_id, company_id, role_id, store_id) VALUES ($1, $2, $3, NULL)`,
        [userId, companyId, roleId],
      ),
    ).rejects.toThrow(/duplicate key value violates unique constraint "uq_user_roles_company_wide"/);
  });

  it("returns one role entry per store when the same role is scoped to multiple stores", async () => {
    const roleRow = await client.query(`SELECT id FROM roles WHERE company_id = $1 AND name = 'Full Access'`, [companyId]);
    const roleId = roleRow.rows[0].id;
    const store2 = await client.query(
      `INSERT INTO stores (company_id, branch_id, store_code, name_en, name_ar)
       VALUES ($1, (SELECT id FROM branches WHERE company_id = $1 LIMIT 1), 'S2', 'Store 2', 'متجر 2') RETURNING id`,
      [companyId],
    );
    await client.query(
      `INSERT INTO user_roles (user_id, company_id, role_id, store_id) VALUES ($1, $2, $3, $4)`,
      [userId, companyId, roleId, storeId],
    );
    await client.query(
      `INSERT INTO user_roles (user_id, company_id, role_id, store_id) VALUES ($1, $2, $3, $4)`,
      [userId, companyId, roleId, store2.rows[0].id],
    );

    const res = await app.inject({
      method: "GET", url: "/api/me",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const storeIds = body.roles
      .filter((r: { name: string; store_id: string | null }) => r.name === "Full Access" && r.store_id !== null)
      .map((r: { store_id: string | null }) => r.store_id);
    expect(storeIds.sort()).toEqual([storeId, store2.rows[0].id].sort());

    await client.query(`DELETE FROM user_roles WHERE user_id = $1 AND store_id IN ($2, $3)`, [userId, storeId, store2.rows[0].id]);
    await client.query(`DELETE FROM stores WHERE id = $1`, [store2.rows[0].id]);
  });
});

describe("master data reads", () => {
  it("lists items with variants", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/items",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].variants.length).toBeGreaterThan(0);
  });

  it("lists customers", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/customers",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().some((c: { id: string }) => c.id === customerId)).toBe(true);
  });

  it("returns a labeled stock-balance snapshot", async () => {
    const res = await app.inject({
      method: "GET", url: `/api/stock-balances?storeId=${storeId}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("asOf");
    expect(res.json()).toHaveProperty("balances");
  });
});

describe("permissions", () => {
  it("rejects creating a sales invoice without the required permission", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/sales-invoices",
      headers: { authorization: `Bearer ${noPermToken}`, "x-company-id": companyId },
      payload: {
        storeId, invoiceChannel: "pos", zatcaInvoiceCategory: "simplified",
        invoiceDate: "2026-03-10", fiscalPeriodId: periodId, customerId,
        lines: [{ itemVariantId, itemDescription: "Item", qty: 1, unitPrice: 115, discountAmount: 0, vatRate: 15, priceIncludesVat: true }],
        payments: [{ paymentMethod: "cash", amount: 115 }],
      },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("sales invoice: create, fetch, post", () => {
  it("creates a draft, posts it, and the GL journal balances", async () => {
    const createRes = await app.inject({
      method: "POST", url: "/api/sales-invoices",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: {
        storeId, invoiceChannel: "pos", zatcaInvoiceCategory: "simplified",
        invoiceDate: "2026-03-10", fiscalPeriodId: periodId, customerId,
        lines: [{ itemVariantId, itemDescription: "Item", qty: 1, unitPrice: 115, discountAmount: 0, vatRate: 15, priceIncludesVat: true }],
        payments: [{ paymentMethod: "cash", amount: 115 }],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const invoiceId = createRes.json().id;

    const getRes = await app.inject({
      method: "GET", url: `/api/sales-invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().document_status).toBe("draft");
    expect(Number(getRes.json().gross_amount)).toBe(115);

    const postRes = await app.inject({
      method: "POST", url: `/api/sales-invoices/${invoiceId}/post`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(postRes.statusCode).toBe(200);

    const afterPost = await app.inject({
      method: "GET", url: `/api/sales-invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(afterPost.json().document_status).toBe("posted");

    // Posted invoices are immutable — a second post attempt must fail cleanly, not 500.
    const secondPostRes = await app.inject({
      method: "POST", url: `/api/sales-invoices/${invoiceId}/post`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(secondPostRes.statusCode).toBe(400);
  });

  it("returns 404 for a sales invoice belonging to a different company", async () => {
    const res = await app.inject({
      method: "GET", url: `/api/sales-invoices/${randomUUID()}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("credit note: create against a posted invoice, post", () => {
  it("full round trip through the HTTP layer", async () => {
    const createInvoiceRes = await app.inject({
      method: "POST", url: "/api/sales-invoices",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: {
        storeId, invoiceChannel: "pos", zatcaInvoiceCategory: "simplified",
        invoiceDate: "2026-03-11", fiscalPeriodId: periodId, customerId,
        lines: [{ itemVariantId, itemDescription: "Item", qty: 2, unitPrice: 57.5, discountAmount: 0, vatRate: 15, priceIncludesVat: true }],
        payments: [{ paymentMethod: "cash", amount: 115 }],
      },
    });
    const invoiceId = createInvoiceRes.json().id;
    await app.inject({
      method: "POST", url: `/api/sales-invoices/${invoiceId}/post`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });

    const invoiceDetail = await app.inject({
      method: "GET", url: `/api/sales-invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    const sourceLineId = invoiceDetail.json().lines[0].id;

    const createCnRes = await app.inject({
      method: "POST", url: "/api/credit-notes",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: {
        storeId, originalInvoiceId: invoiceId, zatcaInvoiceCategory: "simplified",
        creditNoteDate: "2026-03-12", fiscalPeriodId: periodId, customerId, reason: "customer changed mind",
        lines: [{ sourceLineId, itemVariantId, itemDescription: "Item", qty: 1, unitPrice: 57.5, discountAmount: 0, vatRate: 15, priceIncludesVat: true }],
      },
    });
    expect(createCnRes.statusCode).toBe(201);
    const creditNoteId = createCnRes.json().id;

    const postCnRes = await app.inject({
      method: "POST", url: `/api/credit-notes/${creditNoteId}/post`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(postCnRes.statusCode).toBe(200);

    const cnDetail = await app.inject({
      method: "GET", url: `/api/credit-notes/${creditNoteId}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(cnDetail.json().document_status).toBe("posted");
    expect(Number(cnDetail.json().gross_amount)).toBe(57.5);
  });

  it("returns a clean 400, not a 500, when the request body fails validation", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/credit-notes",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { storeId: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });
});
