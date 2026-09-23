/**
 * Payroll: one run per fiscal period, computed from each active employee's
 * stored salary components at posting time (not entered per-run), then one
 * aggregated GL journal.
 *
 * GOSI is calculated on basic_salary only, per employee's stored rates — a
 * simplification (Saudi GOSI is actually computed on basic + housing for
 * Saudi nationals under current rules); a real deployment would need the
 * exact contribution-base rule per nationality, which is out of scope here.
 */

import type { Client } from "pg";
import { round2 } from "../money.js";

async function nextDocumentNumber(
  client: Client,
  companyId: string,
  documentType: string,
  fiscalYear: number,
  prefix: string,
): Promise<string> {
  const r = await client.query<{ fn_next_document_number: string }>(
    `SELECT fn_next_document_number($1, $2, $3, $4) AS fn_next_document_number`,
    [companyId, documentType, fiscalYear, prefix],
  );
  return r.rows[0]!.fn_next_document_number;
}

async function getAccountId(client: Client, companyId: string, code: string): Promise<string> {
  const r = await client.query<{ id: string }>(
    `SELECT id FROM chart_of_accounts WHERE company_id = $1 AND account_code = $2`,
    [companyId, code],
  );
  if (r.rows.length === 0) {
    throw new Error(`chart of accounts is missing required account ${code} for company ${companyId}`);
  }
  return r.rows[0]!.id;
}

export interface CreatePayrollRunParams {
  companyId: string;
  fiscalPeriodId: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  runDate: string;
  createdBy: string;
}

export async function createPayrollRun(client: Client, params: CreatePayrollRunParams): Promise<string> {
  const fiscalYear = Number(params.runDate.slice(0, 4));
  const documentNumber = await nextDocumentNumber(client, params.companyId, "payroll_run", fiscalYear, "PR-");

  const result = await client.query<{ id: string }>(
    `INSERT INTO payroll_runs (company_id, fiscal_period_id, document_number, pay_period_start, pay_period_end, run_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [params.companyId, params.fiscalPeriodId, documentNumber, params.payPeriodStart, params.payPeriodEnd, params.runDate, params.createdBy],
  );
  return result.rows[0]!.id;
}

interface EligibleEmployee {
  id: string;
  basic_salary: string;
  housing_allowance: string;
  other_allowances: string;
  gosi_employee_rate: string;
  gosi_employer_rate: string;
}

export async function postPayrollRun(client: Client, runId: string, postedBy: string): Promise<void> {
  const runResult = await client.query<{
    company_id: string;
    fiscal_period_id: string;
    run_date: Date;
    pay_period_start: string;
    pay_period_end: string;
  }>(
    `SELECT company_id, fiscal_period_id, run_date, pay_period_start, pay_period_end FROM payroll_runs WHERE id = $1`,
    [runId],
  );
  if (runResult.rows.length === 0) throw new Error(`payroll run ${runId} not found`);
  const run = runResult.rows[0]!;

  const employees = await client.query<EligibleEmployee>(
    `SELECT id, basic_salary, housing_allowance, other_allowances, gosi_employee_rate, gosi_employer_rate
     FROM employees
     WHERE company_id = $1 AND status = 'active'
       AND hire_date <= $3
       AND (termination_date IS NULL OR termination_date >= $2)`,
    [run.company_id, run.pay_period_start, run.pay_period_end],
  );
  if (employees.rows.length === 0) {
    throw new Error(`payroll run ${runId} has no eligible employees for this pay period`);
  }

  let totalGross = 0;
  let totalEmployerGosi = 0;
  let totalGosiPayable = 0;
  let totalNetPay = 0;

  for (const emp of employees.rows) {
    const basicSalary = Number(emp.basic_salary);
    const housingAllowance = Number(emp.housing_allowance);
    const otherAllowances = Number(emp.other_allowances);
    const grossPay = round2(basicSalary + housingAllowance + otherAllowances);
    const gosiEmployeeAmount = round2(basicSalary * (Number(emp.gosi_employee_rate) / 100));
    const gosiEmployerAmount = round2(basicSalary * (Number(emp.gosi_employer_rate) / 100));
    const netPay = round2(grossPay - gosiEmployeeAmount);

    await client.query(
      `INSERT INTO payroll_run_lines
         (company_id, payroll_run_id, employee_id, basic_salary, housing_allowance, other_allowances,
          gross_pay, gosi_employee_amount, gosi_employer_amount, net_pay)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [run.company_id, runId, emp.id, basicSalary, housingAllowance, otherAllowances, grossPay, gosiEmployeeAmount, gosiEmployerAmount, netPay],
    );

    totalGross = round2(totalGross + grossPay);
    totalEmployerGosi = round2(totalEmployerGosi + gosiEmployerAmount);
    totalGosiPayable = round2(totalGosiPayable + gosiEmployeeAmount + gosiEmployerAmount);
    totalNetPay = round2(totalNetPay + netPay);
  }

  const salariesExpenseAccountId = await getAccountId(client, run.company_id, "5300");
  const gosiExpenseAccountId = await getAccountId(client, run.company_id, "5310");
  const gosiPayableAccountId = await getAccountId(client, run.company_id, "2200");
  const salariesPayableAccountId = await getAccountId(client, run.company_id, "2210");

  const fiscalYear = Number(run.run_date.toISOString().slice(0, 4));
  const journalNumber = await nextDocumentNumber(client, run.company_id, "journal", fiscalYear, "GJ-");
  const journalResult = await client.query<{ id: string }>(
    `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type, source_id, created_by)
     VALUES ($1, $2, $3, $4, 'payroll_run', $5, $6)
     RETURNING id`,
    [run.company_id, journalNumber, run.run_date, run.fiscal_period_id, runId, postedBy],
  );
  const journalId = journalResult.rows[0]!.id;

  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
     VALUES ($1, $2, 1, $3, $4, 'salaries expense')`,
    [run.company_id, journalId, salariesExpenseAccountId, totalGross],
  );
  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
     VALUES ($1, $2, 2, $3, $4, 'employer GOSI expense')`,
    [run.company_id, journalId, gosiExpenseAccountId, totalEmployerGosi],
  );
  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
     VALUES ($1, $2, 3, $3, $4, 'GOSI payable')`,
    [run.company_id, journalId, gosiPayableAccountId, totalGosiPayable],
  );
  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
     VALUES ($1, $2, 4, $3, $4, 'net salaries payable')`,
    [run.company_id, journalId, salariesPayableAccountId, totalNetPay],
  );

  await client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journalId]);
  await client.query(
    `UPDATE payroll_runs SET document_status = 'posted', posted_by = $2, journal_id = $3 WHERE id = $1`,
    [runId, postedBy, journalId],
  );
}
