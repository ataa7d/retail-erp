import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import type { FastifyInstance } from "fastify";
import { newClient } from "./helpers.js";
import { buildApp } from "../src/api/app.js";
import { createEmployee } from "../src/hr/hrService.js";
import { createPayrollRun, postPayrollRun } from "../src/hr/payrollService.js";

let client: Client;
let app: FastifyInstance;
let companyId: string;
let periodId: string;
let userId: string;
let authToken: string;
let payrollRunId: string;

const PASSWORD = "TestPass123!";

beforeAll(async () => {
  client = newClient();
  await client.connect();
  app = await buildApp();
  await app.ready();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co Payroll Routes', 'شركة') RETURNING id`,
    [`TEST_PRRT_${randomUUID().slice(0, 8)}`],
  );
  companyId = company.rows[0].id;

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
    ["2200", "liability", "credit", "2000"],
    ["2210", "liability", "credit", "2000"],
    ["5300", "expense", "debit", "5000"],
    ["5310", "expense", "debit", "5000"],
  ];
  for (const [code, type, bal, parent] of leaves) {
    await client.query(
      `INSERT INTO chart_of_accounts (company_id, parent_id, account_code, name_en, name_ar, account_type, normal_balance)
       VALUES ($1, $2, $3, $3, $3, $4, $5)`,
      [companyId, groupIds[parent], code, type, bal],
    );
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Payroll Route User', 'مستخدم') RETURNING id, email`,
    [`payrollrouteuser_${randomUUID()}@test.local`, passwordHash],
  );
  userId = user.rows[0].id;
  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [userId, companyId]);

  await createEmployee(client, {
    companyId,
    departmentId: null,
    positionId: null,
    storeId: null,
    employeeCode: "EMP-RT-1",
    fullNameEn: "Route Test Employee",
    fullNameAr: "موظف اختبار المسار",
    nationalId: null,
    nationality: null,
    hireDate: "2026-01-01",
    basicSalary: 4000,
    housingAllowance: 0,
    otherAllowances: 0,
    gosiEmployeeRate: 9.75,
    gosiEmployerRate: 11.75,
    createdBy: userId,
  });

  payrollRunId = await createPayrollRun(client, {
    companyId,
    fiscalPeriodId: periodId,
    payPeriodStart: "2026-09-01",
    payPeriodEnd: "2026-09-30",
    runDate: "2026-09-30",
    createdBy: userId,
  });
  await postPayrollRun(client, payrollRunId, userId);

  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: user.rows[0].email, password: PASSWORD } });
  authToken = loginRes.json().token;
});

afterAll(async () => {
  await app.close();
  await client.query(`SET app.bypass_immutability = 'true'`);
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM payroll_run_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM payroll_runs WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journal_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journals WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM employees WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.query(`DELETE FROM chart_of_accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("GET /payroll-runs/:id", () => {
  it("joins each line with the employee's name and code for payslip display", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/payroll-runs/${payrollRunId}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]).toMatchObject({
      employee_code: "EMP-RT-1",
      full_name_en: "Route Test Employee",
      full_name_ar: "موظف اختبار المسار",
    });
    expect(Number(body.lines[0].gross_pay)).toBe(4000);
    expect(Number(body.lines[0].net_pay)).toBe(4000 - Number(body.lines[0].gosi_employee_amount));
  });
});
