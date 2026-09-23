/**
 * HR master data: departments, positions, employees. Intentionally thin —
 * no attendance/leave/appraisal tracking, just what src/hr/payrollService.ts
 * needs (salary components, employment status/dates).
 */

import type { Client } from "pg";

export interface CreateDepartmentParams {
  companyId: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

export async function createDepartment(client: Client, params: CreateDepartmentParams): Promise<string> {
  const r = await client.query<{ id: string }>(
    `INSERT INTO departments (company_id, code, name_en, name_ar) VALUES ($1, $2, $3, $4) RETURNING id`,
    [params.companyId, params.code, params.nameEn, params.nameAr],
  );
  return r.rows[0]!.id;
}

export interface CreatePositionParams {
  companyId: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

export async function createPosition(client: Client, params: CreatePositionParams): Promise<string> {
  const r = await client.query<{ id: string }>(
    `INSERT INTO positions (company_id, code, name_en, name_ar) VALUES ($1, $2, $3, $4) RETURNING id`,
    [params.companyId, params.code, params.nameEn, params.nameAr],
  );
  return r.rows[0]!.id;
}

export interface CreateEmployeeParams {
  companyId: string;
  departmentId: string | null;
  positionId: string | null;
  storeId: string | null;
  employeeCode: string;
  fullNameEn: string;
  fullNameAr: string;
  nationalId: string | null;
  nationality: string | null;
  hireDate: string;
  basicSalary: number;
  housingAllowance?: number;
  otherAllowances?: number;
  gosiEmployeeRate?: number;
  gosiEmployerRate?: number;
  createdBy: string;
}

export async function createEmployee(client: Client, params: CreateEmployeeParams): Promise<string> {
  const r = await client.query<{ id: string }>(
    `INSERT INTO employees
       (company_id, department_id, position_id, store_id, employee_code, full_name_en, full_name_ar,
        national_id, nationality, hire_date, basic_salary, housing_allowance, other_allowances,
        gosi_employee_rate, gosi_employer_rate, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id`,
    [
      params.companyId,
      params.departmentId,
      params.positionId,
      params.storeId,
      params.employeeCode,
      params.fullNameEn,
      params.fullNameAr,
      params.nationalId,
      params.nationality,
      params.hireDate,
      params.basicSalary,
      params.housingAllowance ?? 0,
      params.otherAllowances ?? 0,
      params.gosiEmployeeRate ?? 9.75,
      params.gosiEmployerRate ?? 11.75,
      params.createdBy,
    ],
  );
  return r.rows[0]!.id;
}

export async function terminateEmployee(client: Client, employeeId: string, terminationDate: string): Promise<void> {
  await client.query(
    `UPDATE employees SET status = 'terminated', termination_date = $2 WHERE id = $1`,
    [employeeId, terminationDate],
  );
}
