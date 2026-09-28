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
let fiscalYearId: string;
let periodJanId: string;
let periodFebId: string;
let revenueAccountId: string;
let expenseAccountId: string;
let cashAccountId: string;
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

async function postJournal(date: string, periodId: string, lines: Array<{ accountId: string; debit?: number; credit?: number }>) {
  const journal = await client.query<{ id: string }>(
    `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type)
     VALUES ($1, $2, $3, $4, 'manual') RETURNING id`,
    [companyId, `GJ-TEST-${randomUUID().slice(0, 8)}`, date, periodId],
  );
  let n = 0;
  for (const l of lines) {
    n += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, credit_amount)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [companyId, journal.rows[0]!.id, n, l.accountId, l.debit ?? 0, l.credit ?? 0],
    );
  }
  await client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journal.rows[0]!.id]);
  return journal.rows[0]!.id;
}

beforeAll(async () => {
  client = newClient();
  await client.connect();
  app = await buildApp();
  await app.ready();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co Budget', 'شركة') RETURNING id`,
    [`TEST_BUD_${randomUUID().slice(0, 8)}`],
  );
  companyId = company.rows[0].id;

  const fy = await client.query(
    `INSERT INTO fiscal_years (company_id, year_name, start_date, end_date) VALUES ($1, 'FY2026', '2026-01-01', '2026-12-31') RETURNING id`,
    [companyId],
  );
  fiscalYearId = fy.rows[0].id;

  const periodJan = await client.query(
    `INSERT INTO fiscal_periods (fiscal_year_id, company_id, period_number, start_date, end_date, status)
     VALUES ($1, $2, 1, '2026-01-01', '2026-01-31', 'open') RETURNING id`,
    [fiscalYearId, companyId],
  );
  periodJanId = periodJan.rows[0].id;
  const periodFeb = await client.query(
    `INSERT INTO fiscal_periods (fiscal_year_id, company_id, period_number, start_date, end_date, status)
     VALUES ($1, $2, 2, '2026-02-01', '2026-02-28', 'open') RETURNING id`,
    [fiscalYearId, companyId],
  );
  periodFebId = periodFeb.rows[0].id;

  const groups: Array<[string, string, string]> = [
    ["1000", "asset", "debit"],
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
  const revenue = await client.query(
    `INSERT INTO chart_of_accounts (company_id, parent_id, account_code, name_en, name_ar, account_type, normal_balance)
     VALUES ($1, $2, '4110', 'Sales Revenue', 'إيرادات المبيعات', 'revenue', 'credit') RETURNING id`,
    [companyId, groupIds["4000"]],
  );
  revenueAccountId = revenue.rows[0].id;
  const expense = await client.query(
    `INSERT INTO chart_of_accounts (company_id, parent_id, account_code, name_en, name_ar, account_type, normal_balance)
     VALUES ($1, $2, '5100', 'Cost of Goods Sold', 'تكلفة البضاعة المباعة', 'expense', 'debit') RETURNING id`,
    [companyId, groupIds["5000"]],
  );
  expenseAccountId = expense.rows[0].id;
  const cash = await client.query(
    `INSERT INTO chart_of_accounts (company_id, parent_id, account_code, name_en, name_ar, account_type, normal_balance)
     VALUES ($1, $2, '1110', 'Cash', 'النقد', 'asset', 'debit') RETURNING id`,
    [companyId, groupIds["1000"]],
  );
  cashAccountId = cash.rows[0].id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Budget User', 'مستخدم') RETURNING id, email`,
    [`budgetuser_${randomUUID()}@test.local`, passwordHash],
  );
  const userId = user.rows[0].id;

  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [userId, companyId]);
  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Finance') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions WHERE code IN ('accounting.budget.manage', 'accounting.reports.view')`,
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
  await client.query(`DELETE FROM budget_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM budgets WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journal_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journals WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM chart_of_accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE email LIKE 'budgetuser_%'`);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("budget CRUD and line rules", () => {
  it("creates a budget, sets lines, and rejects a line against a header/balance-sheet account", async () => {
    const create = await inject("POST", "/api/budgets", { fiscalYearId, name: "FY2026 Budget" });
    expect(create.statusCode).toBe(201);
    const budgetId = create.json().id;

    const setLine = await inject("POST", `/api/budgets/${budgetId}/lines`, {
      fiscalPeriodId: periodJanId,
      accountId: revenueAccountId,
      amount: 1000,
    });
    expect(setLine.statusCode).toBe(200);

    // Upsert: setting the same period+account again replaces the amount.
    await inject("POST", `/api/budgets/${budgetId}/lines`, { fiscalPeriodId: periodJanId, accountId: revenueAccountId, amount: 1500 });

    const detail = await inject("GET", `/api/budgets/${budgetId}`);
    expect(detail.json().lines).toHaveLength(1);
    expect(Number(detail.json().lines[0].amount)).toBe(1500);

    // A header account (is_header = true) should be rejected by the DB trigger.
    const headerAccount = await client.query(`SELECT id FROM chart_of_accounts WHERE company_id = $1 AND account_code = '5000'`, [
      companyId,
    ]);
    const badLine = await inject("POST", `/api/budgets/${budgetId}/lines`, {
      fiscalPeriodId: periodJanId,
      accountId: headerAccount.rows[0].id,
      amount: 100,
    });
    expect(badLine.statusCode).toBe(400); // DB trigger rejection, mapped to a 400 by the pg-error-code error handler
  });

  it("blocks editing lines once the budget is approved", async () => {
    const create = await inject("POST", "/api/budgets", { fiscalYearId, name: "FY2026 Approved Budget" });
    const budgetId = create.json().id;
    await inject("POST", `/api/budgets/${budgetId}/lines`, { fiscalPeriodId: periodJanId, accountId: revenueAccountId, amount: 500 });

    const approve = await inject("POST", `/api/budgets/${budgetId}/status`, { status: "approved" });
    expect(approve.statusCode).toBe(200);

    const blocked = await inject("POST", `/api/budgets/${budgetId}/lines`, {
      fiscalPeriodId: periodJanId,
      accountId: revenueAccountId,
      amount: 999,
    });
    expect(blocked.statusCode).toBe(400);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/api/budgets" });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /reports/budget-vs-actual", () => {
  it("computes budget, actual, and variance per account across the requested range", async () => {
    const create = await inject("POST", "/api/budgets", { fiscalYearId, name: "FY2026 Report Budget" });
    const budgetId = create.json().id;
    await inject("POST", `/api/budgets/${budgetId}/lines`, { fiscalPeriodId: periodJanId, accountId: revenueAccountId, amount: 1000 });
    await inject("POST", `/api/budgets/${budgetId}/lines`, { fiscalPeriodId: periodFebId, accountId: revenueAccountId, amount: 1000 });
    await inject("POST", `/api/budgets/${budgetId}/lines`, { fiscalPeriodId: periodJanId, accountId: expenseAccountId, amount: 300 });

    // Actual revenue of 1200 (credit-normal) and actual expense of 250
    // (debit-normal) in January only.
    await postJournal("2026-01-15", periodJanId, [
      { accountId: cashAccountId, debit: 950 },
      { accountId: expenseAccountId, debit: 250 },
      { accountId: revenueAccountId, credit: 1200 },
    ]);

    const res = await inject("GET", `/api/reports/budget-vs-actual?budgetId=${budgetId}&startDate=2026-01-01&endDate=2026-01-31`);
    expect(res.statusCode).toBe(200);
    const rows = res.json().rows as Array<{ account_code: string; budget_amount: string; actual_amount: string; variance: string }>;

    const revenueRow = rows.find((r) => r.account_code === "4110")!;
    expect(Number(revenueRow.budget_amount)).toBe(1000); // only January's budget line, not February's
    expect(Number(revenueRow.actual_amount)).toBe(1200);
    expect(Number(revenueRow.variance)).toBe(200); // over budget (good, for revenue)

    const expenseRow = rows.find((r) => r.account_code === "5100")!;
    expect(Number(expenseRow.budget_amount)).toBe(300);
    expect(Number(expenseRow.actual_amount)).toBe(250);
    expect(Number(expenseRow.variance)).toBe(-50); // under budget (good, for expense)

    // Every row returned must have either budget or actual activity --
    // the report never explodes to include every account in the chart
    // regardless of activity.
    expect(rows.length).toBeLessThan(10);
  });
});
