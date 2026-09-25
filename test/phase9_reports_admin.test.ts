import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Client } from "pg";
import { newClient } from "./helpers.js";
import { buildApp } from "../src/api/app.js";
import { createSalesInvoice, postSalesInvoice } from "../src/sales/salesService.js";

let app: FastifyInstance;
let client: Client;
let companyId: string;
let storeId: string;
let periodId: string;
let customerId: string;
let itemVariantId: string;
let userId: string;
let authToken: string;
let noPermToken: string;
const extraUserIds: string[] = []; // users created by the admin-management tests themselves, cleaned up in afterAll

const PASSWORD = "TestPass123!";

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  client = newClient();
  await client.connect();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co P9R', 'شركة') RETURNING id`,
    [`TEST_P9R_${randomUUID().slice(0, 8)}`],
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
     VALUES ($1, $2, 1, '2026-01-01', '2026-01-31', 'open') RETURNING id`,
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
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'P9R Test User', 'مستخدم') RETURNING id`,
    [`p9ruser_${randomUUID()}@test.local`, passwordHash],
  );
  userId = user.rows[0].id;
  const userEmail = (await client.query(`SELECT email FROM users WHERE id = $1`, [userId])).rows[0].email;

  // A posted wholesale sale so the reports have something real to show:
  // 1000 net + 150 VAT = 1150 gross, all on credit (AR).
  const invoiceId = await createSalesInvoice(client, {
    companyId, storeId, invoiceChannel: "wholesale", zatcaInvoiceCategory: "standard",
    invoiceDate: "2026-01-15", fiscalPeriodId: periodId, customerId, salespersonId: null, priceListId: null,
    createdBy: userId,
    lines: [{ itemVariantId, itemDescription: "Item", qty: 1, unitPrice: 1000, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
  });
  await postSalesInvoice(client, invoiceId, userId);

  const otherUser = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'No Perm', 'مستخدم') RETURNING id`,
    [`p9rnoperm_${randomUUID()}@test.local`, passwordHash],
  );
  const otherEmail = (await client.query(`SELECT email FROM users WHERE id = $1`, [otherUser.rows[0].id])).rows[0].email;

  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2), ($3, $2)`, [
    userId, companyId, otherUser.rows[0].id,
  ]);

  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Reports Access') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code IN ('accounting.reports.view', 'admin.users.manage', 'admin.audit_log.view', 'admin.roles.manage')`,
    [role.rows[0].id],
  );
  await client.query(`INSERT INTO user_roles (user_id, company_id, role_id) VALUES ($1, $2, $3)`, [userId, companyId, role.rows[0].id]);

  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: userEmail, password: PASSWORD } });
  authToken = loginRes.json().token;
  const noPermLoginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: otherEmail, password: PASSWORD } });
  noPermToken = noPermLoginRes.json().token;
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
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  if (extraUserIds.length > 0) {
    await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [extraUserIds]);
  }
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

describe("reporting functions", () => {
  it("trial balance is itself balanced (total debits = total credits) and includes the posted sale", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/reports/trial-balance?asOfDate=2026-01-31",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().rows as Array<{ account_code: string; debit_balance: string; credit_balance: string }>;
    const totalDebit = rows.reduce((s, r) => s + Number(r.debit_balance), 0);
    const totalCredit = rows.reduce((s, r) => s + Number(r.credit_balance), 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 2);

    const ar = rows.find((r) => r.account_code === "1120");
    expect(Number(ar!.debit_balance)).toBe(1150);
  });

  it("income statement shows the sale's revenue for the period", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/reports/income-statement?startDate=2026-01-01&endDate=2026-01-31",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().rows as Array<{ account_code: string; amount: string }>;
    const revenue = rows.find((r) => r.account_code === "4110");
    expect(Number(revenue!.amount)).toBe(1000);
  });

  it("balance sheet balances: assets = liabilities + equity, including current-year earnings", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/reports/balance-sheet?asOfDate=2026-01-31",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().rows as Array<{ account_type: string; balance: string }>;

    const assets = rows.filter((r) => r.account_type === "asset").reduce((s, r) => s + Number(r.balance), 0);
    const liabilities = rows.filter((r) => r.account_type === "liability").reduce((s, r) => s + Number(r.balance), 0);
    const equity = rows.filter((r) => r.account_type === "equity").reduce((s, r) => s + Number(r.balance), 0);
    expect(assets).toBeCloseTo(liabilities + equity, 2);

    const currentEarnings = rows.find((r) => (r as unknown as { account_code: string }).account_code === "CURRENT_EARNINGS");
    expect(currentEarnings).toBeDefined();
    expect(Number(currentEarnings!.balance)).toBe(1000); // 1000 revenue, no expenses posted
  });

  it("rejects a report request without accounting.reports.view", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/reports/trial-balance?asOfDate=2026-01-31",
      headers: { authorization: `Bearer ${noPermToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("admin routes", () => {
  it("lists company users with their roles", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/admin/users",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    const me = res.json().find((u: { id: string }) => u.id === userId);
    expect(me.roles).toContain("Reports Access");
  });

  it("returns the audit trail for this company, newest first", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/admin/audit-log?limit=5",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeGreaterThan(0);
    expect(res.json().length).toBeLessThanOrEqual(5);
  });

  it("rejects admin routes without the admin permission", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/admin/roles",
      headers: { authorization: `Bearer ${noPermToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(403);
  });

  it("invites a brand-new user and grants them company access", async () => {
    const email = `p9r_invited_${randomUUID()}@test.local`;
    const res = await app.inject({
      method: "POST", url: "/api/admin/users",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { email, fullNameEn: "Invited User", fullNameAr: "مستخدم مدعو", password: "TestPass123!" },
    });
    expect(res.statusCode).toBe(201);
    extraUserIds.push(res.json().id);

    const detail = await app.inject({
      method: "GET", url: `/api/admin/users/${res.json().id}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(detail.json().email.toLowerCase()).toBe(email.toLowerCase());
    expect(detail.json().has_company_access).toBe(true);
  });

  it("inviting an already-existing email just (re)grants company access instead of erroring", async () => {
    const email = `p9r_existing_${randomUUID()}@test.local`;
    const first = await app.inject({
      method: "POST", url: "/api/admin/users",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { email, fullNameEn: "Existing User", fullNameAr: "مستخدم", password: "TestPass123!" },
    });
    extraUserIds.push(first.json().id);

    const second = await app.inject({
      method: "POST", url: "/api/admin/users",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { email, fullNameEn: "Existing User", fullNameAr: "مستخدم", password: "TestPass123!" },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().id).toBe(first.json().id); // same underlying user, not a duplicate
  });

  it("cannot deactivate your own company access", async () => {
    const res = await app.inject({
      method: "POST", url: `/api/admin/users/${userId}/deactivate`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(400);
  });

  it("deactivates and reactivates a user's company access", async () => {
    const invited = await app.inject({
      method: "POST", url: "/api/admin/users",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { email: `p9r_toggle_${randomUUID()}@test.local`, fullNameEn: "Toggle User", fullNameAr: "مستخدم", password: "TestPass123!" },
    });
    extraUserIds.push(invited.json().id);

    const deactivated = await app.inject({
      method: "POST", url: `/api/admin/users/${invited.json().id}/deactivate`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json().hasCompanyAccess).toBe(false);

    const reactivated = await app.inject({
      method: "POST", url: `/api/admin/users/${invited.json().id}/reactivate`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json().hasCompanyAccess).toBe(true);
  });

  it("creates a role, sets its permissions, and lists the full permission catalog", async () => {
    const catalog = await app.inject({
      method: "GET", url: "/api/admin/permissions",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().length).toBeGreaterThan(10);

    const created = await app.inject({
      method: "POST", url: "/api/admin/roles",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { name: `Cashier ${randomUUID().slice(0, 8)}`, description: "POS-only role" },
    });
    expect(created.statusCode).toBe(201);
    const roleId = created.json().id;

    const setPerms = await app.inject({
      method: "POST", url: `/api/admin/roles/${roleId}/permissions`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { permissionCodes: ["sales.pos_invoice.create"] },
    });
    expect(setPerms.statusCode).toBe(200);

    const roles = await app.inject({
      method: "GET", url: "/api/admin/roles",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    const role = roles.json().find((r: { id: string }) => r.id === roleId);
    expect(role.permissions).toEqual(["sales.pos_invoice.create"]);

    // Replacing again drops what isn't listed, doesn't just add to it.
    await app.inject({
      method: "POST", url: `/api/admin/roles/${roleId}/permissions`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { permissionCodes: ["inventory.items.manage"] },
    });
    const rolesAfter = await app.inject({
      method: "GET", url: "/api/admin/roles",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    const roleAfter = rolesAfter.json().find((r: { id: string }) => r.id === roleId);
    expect(roleAfter.permissions).toEqual(["inventory.items.manage"]);

    const deactivated = await app.inject({
      method: "POST", url: `/api/admin/roles/${roleId}/deactivate`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(deactivated.json().isActive).toBe(false);
    const reactivated = await app.inject({
      method: "POST", url: `/api/admin/roles/${roleId}/reactivate`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(reactivated.json().isActive).toBe(true);
  });

  it("assigns a store-scoped role to a user and can remove the assignment", async () => {
    const invited = await app.inject({
      method: "POST", url: "/api/admin/users",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { email: `p9r_scoped_${randomUUID()}@test.local`, fullNameEn: "Scoped User", fullNameAr: "مستخدم", password: "TestPass123!" },
    });
    extraUserIds.push(invited.json().id);
    const targetUserId = invited.json().id;

    const role = await app.inject({
      method: "POST", url: "/api/admin/roles",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { name: `Store Clerk ${randomUUID().slice(0, 8)}` },
    });
    const roleId = role.json().id;

    const assign = await app.inject({
      method: "POST", url: `/api/admin/users/${targetUserId}/roles`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { roleId, storeId },
    });
    expect(assign.statusCode).toBe(201);
    const userRoleId = assign.json().id;
    expect(userRoleId).toBeTruthy();

    const detail = await app.inject({
      method: "GET", url: `/api/admin/users/${targetUserId}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    const assignment = detail.json().roleAssignments.find((a: { id: string }) => a.id === userRoleId);
    expect(assignment.store_id).toBe(storeId);

    const removed = await app.inject({
      method: "POST", url: `/api/admin/users/${targetUserId}/roles/${userRoleId}/remove`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(removed.statusCode).toBe(200);

    const detailAfter = await app.inject({
      method: "GET", url: `/api/admin/users/${targetUserId}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(detailAfter.json().roleAssignments).toEqual([]);
  });
});
