import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Client } from "pg";
import { newClient } from "./helpers.js";
import { buildApp } from "../src/api/app.js";
import { recordStockMovement } from "../src/inventory/inventoryService.js";

let app: FastifyInstance;
let client: Client;
let companyId: string;
let storeId: string;
let periodId: string;
let itemVariantId: string;
let lowStockVariantId: string;
let authToken: string;

const PASSWORD = "TestPass123!";
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  client = newClient();
  await client.connect();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co Dash', 'شركة') RETURNING id`,
    [`TEST_DASH_${randomUUID().slice(0, 8)}`],
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
     VALUES ($1, $2, 9, '2026-09-01', '2026-09-30', 'open') RETURNING id`,
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

  const item = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, 'IT-1', 'Item', 'صنف') RETURNING id`,
    [companyId],
  );
  const variant = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, 'SKU-1') RETURNING id`,
    [companyId, item.rows[0].id],
  );
  itemVariantId = variant.rows[0].id;

  const lowItem = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, 'IT-LOW', 'Low Stock Item', 'صنف منخفض') RETURNING id`,
    [companyId],
  );
  const lowVariant = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code, reorder_point) VALUES ($1, $2, 'SKU-LOW', 10) RETURNING id`,
    [companyId, lowItem.rows[0].id],
  );
  lowStockVariantId = lowVariant.rows[0].id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Dash Test User', 'مستخدم') RETURNING id`,
    [`dashuser_${randomUUID()}@test.local`, passwordHash],
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
  await client.query(`DELETE FROM user_roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_variants WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM items WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM chart_of_accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("GET /api/dashboard/summary", () => {
  it("reflects zero activity before anything is posted, except reorder-point items with no stock yet", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/summary",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.todaySales).toEqual({ total: 0, count: 0 });
    expect(body.inventoryValue).toBe(0);
    expect(body.lowStockCount).toBe(1); // the SKU-LOW variant: reorder_point 10, zero stock
  });

  it("counts a posted invoice in today's sales and month-to-date sales", async () => {
    await recordStockMovement(client, {
      companyId, storeId, itemVariantId, movementType: "receipt",
      qty: 50, explicitUnitCost: 20, sourceType: "test", createdBy: null,
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/sales-invoices",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: {
        storeId,
        invoiceChannel: "pos",
        zatcaInvoiceCategory: "simplified",
        invoiceDate: today,
        fiscalPeriodId: periodId,
        lines: [{ itemVariantId, itemDescription: "Item", qty: 2, unitPrice: 57.5, discountAmount: 0, vatRate: 15, priceIncludesVat: true }],
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

    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/summary",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    const body = res.json();
    expect(body.todaySales.count).toBe(1);
    expect(body.todaySales.total).toBe(115);
    expect(body.monthToDateSales.count).toBe(1);
    expect(body.monthToDateSales.total).toBe(115);
    expect(body.inventoryValue).toBeGreaterThan(0); // 48 units left at cost 20
  });

  it("resolves once stock covers the reorder point", async () => {
    await recordStockMovement(client, {
      companyId, storeId, itemVariantId: lowStockVariantId, movementType: "receipt",
      qty: 15, explicitUnitCost: 3, sourceType: "test", createdBy: null,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/summary",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.json().lowStockCount).toBe(0);

    const lowStockRes = await app.inject({
      method: "GET",
      url: "/api/dashboard/low-stock",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(lowStockRes.json()).toEqual([]);
  });
});
