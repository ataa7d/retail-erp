import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { newClient } from "./helpers.js";
import { acquireFixedAsset, createDepreciationRun, postDepreciationRun, disposeFixedAsset } from "../src/assets/fixedAssetService.js";
import { createDepartment, createPosition, createEmployee } from "../src/hr/hrService.js";
import { createPayrollRun, postPayrollRun } from "../src/hr/payrollService.js";

let client: Client;
let companyId: string;
let storeId: string;
let fiscalYearId: string;
let periods: Array<{ id: string; period_number: number }> = [];
let userId: string;
let assetCategoryId: string;

beforeAll(async () => {
  client = newClient();
  await client.connect();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co P9', 'شركة') RETURNING id`,
    [`TEST_P9_${randomUUID().slice(0, 8)}`],
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
  fiscalYearId = fy.rows[0].id;

  for (let m = 1; m <= 2; m++) {
    const start = new Date(Date.UTC(2026, m - 1, 1));
    const end = new Date(Date.UTC(2026, m, 0));
    const period = await client.query(
      `INSERT INTO fiscal_periods (fiscal_year_id, company_id, period_number, start_date, end_date, status)
       VALUES ($1, $2, $3, $4, $5, 'open') RETURNING id, period_number`,
      [fiscalYearId, companyId, m, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)],
    );
    periods.push(period.rows[0]);
  }

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
    ["1210", "asset", "debit", "1000"],
    ["1290", "asset", "credit", "1000"], // contra-asset: normal balance credit
    ["2200", "liability", "credit", "2000"],
    ["2210", "liability", "credit", "2000"],
    ["4200", "revenue", "credit", "4000"],
    ["5200", "expense", "debit", "5000"],
    ["5210", "expense", "debit", "5000"],
    ["5300", "expense", "debit", "5000"],
    ["5310", "expense", "debit", "5000"],
  ];
  const leafIds: Record<string, string> = {};
  for (const [code, type, bal, parent] of leaves) {
    const r = await client.query(
      `INSERT INTO chart_of_accounts (company_id, parent_id, account_code, name_en, name_ar, account_type, normal_balance)
       VALUES ($1, $2, $3, $3, $3, $4, $5) RETURNING id`,
      [companyId, groupIds[parent], code, type, bal],
    );
    leafIds[code] = r.rows[0].id;
  }

  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, 'x', 'Test User', 'مستخدم') RETURNING id`,
    [`p9user_${randomUUID()}@test.local`],
  );
  userId = user.rows[0].id;

  const category = await client.query(
    `INSERT INTO asset_categories
       (company_id, code, name_en, name_ar, default_useful_life_months, asset_account_id, accumulated_depreciation_account_id, depreciation_expense_account_id)
     VALUES ($1, 'EQUIP', 'Equipment', 'معدات', 12, $2, $3, $4)
     RETURNING id`,
    [companyId, leafIds["1210"], leafIds["1290"], leafIds["5200"]],
  );
  assetCategoryId = category.rows[0].id;
});

afterAll(async () => {
  await client.query(`SET app.bypass_immutability = 'true'`);
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM payroll_run_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM payroll_runs WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM employees WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM positions WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM departments WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM depreciation_run_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM depreciation_runs WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fixed_assets WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM asset_categories WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journal_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journals WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM chart_of_accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("fixed assets: acquisition, depreciation, disposal", () => {
  it("acquires an asset with a balanced cash-purchase journal", async () => {
    const assetId = await acquireFixedAsset(client, {
      companyId, assetCategoryId, storeId, assetCode: "FA-1", nameEn: "Laptop", nameAr: "حاسوب",
      acquisitionDate: "2026-01-05", acquisitionCost: 1200, salvageValue: 0, fiscalPeriodId: periods[0]!.id, createdBy: userId,
    });

    const asset = await client.query(`SELECT * FROM fixed_assets WHERE id = $1`, [assetId]);
    expect(Number(asset.rows[0].acquisition_cost)).toBe(1200);
    expect(asset.rows[0].useful_life_months).toBe(12);

    const journal = await client.query(`SELECT debit_amount, credit_amount FROM journal_lines WHERE journal_id = $1`, [
      asset.rows[0].acquisition_journal_id,
    ]);
    const debit = journal.rows.reduce((s: number, r: { debit_amount: string }) => s + Number(r.debit_amount), 0);
    const credit = journal.rows.reduce((s: number, r: { credit_amount: string }) => s + Number(r.credit_amount), 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(1200);
  });

  it("posts a straight-line depreciation run across all active assets, aggregated by category", async () => {
    const runId = await createDepreciationRun(client, {
      companyId, fiscalPeriodId: periods[0]!.id, runDate: "2026-01-31", createdBy: userId,
    });
    await postDepreciationRun(client, runId, userId);

    const run = await client.query(`SELECT document_status, journal_id FROM depreciation_runs WHERE id = $1`, [runId]);
    expect(run.rows[0].document_status).toBe("posted");

    // 1200 cost / 12 months = 100 for the one asset acquired this period.
    const asset = await client.query(`SELECT accumulated_depreciation, status FROM fixed_assets WHERE company_id = $1 AND asset_code = 'FA-1'`, [companyId]);
    expect(Number(asset.rows[0].accumulated_depreciation)).toBe(100);
    expect(asset.rows[0].status).toBe("active");

    const lines = await client.query(`SELECT debit_amount, credit_amount FROM journal_lines WHERE journal_id = $1`, [run.rows[0].journal_id]);
    const debit = lines.rows.reduce((s: number, r: { debit_amount: string }) => s + Number(r.debit_amount), 0);
    const credit = lines.rows.reduce((s: number, r: { credit_amount: string }) => s + Number(r.credit_amount), 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(100);
  });

  it("only allows one depreciation run per fiscal period", async () => {
    await expect(
      client.query(
        `INSERT INTO depreciation_runs (company_id, fiscal_period_id, document_number, run_date, created_by) VALUES ($1, $2, 'DUPE', '2026-01-31', $3)`,
        [companyId, periods[0]!.id, userId],
      ),
    ).rejects.toThrow();
  });

  it("disposes an asset for a gain and books it, then freezes the asset permanently", async () => {
    const assetId = await acquireFixedAsset(client, {
      companyId, assetCategoryId, storeId, assetCode: "FA-2", nameEn: "Printer", nameAr: "طابعة",
      acquisitionDate: "2026-02-01", acquisitionCost: 500, salvageValue: 0, fiscalPeriodId: periods[1]!.id, createdBy: userId,
    });

    // Dispose immediately for more than cost -> a gain, with zero
    // accumulated depreciation yet (no depreciation run has touched it).
    await disposeFixedAsset(client, {
      assetId, disposalDate: "2026-02-05", proceeds: 550, fiscalPeriodId: periods[1]!.id, postedBy: userId,
    });

    const asset = await client.query(`SELECT status, disposal_proceeds, disposal_journal_id FROM fixed_assets WHERE id = $1`, [assetId]);
    expect(asset.rows[0].status).toBe("disposed");
    expect(Number(asset.rows[0].disposal_proceeds)).toBe(550);

    const lines = await client.query(`SELECT debit_amount, credit_amount FROM journal_lines WHERE journal_id = $1`, [
      asset.rows[0].disposal_journal_id,
    ]);
    const debit = lines.rows.reduce((s: number, r: { debit_amount: string }) => s + Number(r.debit_amount), 0);
    const credit = lines.rows.reduce((s: number, r: { credit_amount: string }) => s + Number(r.credit_amount), 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(550); // cash 550 debit = asset 500 credit + gain 50 credit

    await expect(
      disposeFixedAsset(client, { assetId, disposalDate: "2026-02-06", proceeds: 1, fiscalPeriodId: periods[1]!.id, postedBy: userId }),
    ).rejects.toThrow(/already disposed/);
  });
});

describe("payroll", () => {
  it("posts a payroll run and books a balanced salaries/GOSI journal", async () => {
    const dept = await createDepartment(client, { companyId, code: "OPS", nameEn: "Operations", nameAr: "العمليات" });
    const position = await createPosition(client, { companyId, code: "CASHIER", nameEn: "Cashier", nameAr: "أمين الصندوق" });
    const employeeId = await createEmployee(client, {
      companyId, departmentId: dept, positionId: position, storeId,
      employeeCode: "EMP-1", fullNameEn: "Ahmed Ali", fullNameAr: "أحمد علي",
      nationalId: "1234567890", nationality: "Saudi", hireDate: "2026-01-01",
      basicSalary: 4000, housingAllowance: 1000, otherAllowances: 200,
      gosiEmployeeRate: 9.75, gosiEmployerRate: 11.75, createdBy: userId,
    });

    const runId = await createPayrollRun(client, {
      companyId, fiscalPeriodId: periods[0]!.id, payPeriodStart: "2026-01-01", payPeriodEnd: "2026-01-31",
      runDate: "2026-01-31", createdBy: userId,
    });
    await postPayrollRun(client, runId, userId);

    const line = await client.query(`SELECT * FROM payroll_run_lines WHERE payroll_run_id = $1 AND employee_id = $2`, [runId, employeeId]);
    expect(Number(line.rows[0].gross_pay)).toBe(5200); // 4000 + 1000 + 200
    expect(Number(line.rows[0].gosi_employee_amount)).toBe(390); // 4000 * 9.75%
    expect(Number(line.rows[0].net_pay)).toBe(4810); // 5200 - 390

    const run = await client.query(`SELECT document_status, journal_id FROM payroll_runs WHERE id = $1`, [runId]);
    expect(run.rows[0].document_status).toBe("posted");

    const lines = await client.query(`SELECT debit_amount, credit_amount FROM journal_lines WHERE journal_id = $1`, [run.rows[0].journal_id]);
    const debit = lines.rows.reduce((s: number, r: { debit_amount: string }) => s + Number(r.debit_amount), 0);
    const credit = lines.rows.reduce((s: number, r: { credit_amount: string }) => s + Number(r.credit_amount), 0);
    expect(debit).toBeCloseTo(credit, 2);
  });

  it("rejects a payroll run with no eligible employees for its pay period", async () => {
    // A pay period entirely before EMP-1's hire date (2026-01-01) has zero
    // eligible employees, even though the fiscal period itself is valid.
    const runId = await createPayrollRun(client, {
      companyId, fiscalPeriodId: periods[1]!.id, payPeriodStart: "2025-12-01", payPeriodEnd: "2025-12-31",
      runDate: "2026-02-01", createdBy: userId,
    });
    await expect(postPayrollRun(client, runId, userId)).rejects.toThrow(/no eligible employees/);
  });
});
