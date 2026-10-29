-- Phase 5 of read-access permissions (see 0085's comment for the full
-- rationale): HR. Unlike the write side (hr.employee.manage,
-- hr.payroll.post, unchanged here), every GET route in hr.ts and
-- payroll.ts currently has no permission check at all -- any
-- authenticated user can read every employee's basic salary, housing
-- allowance, other allowances, GOSI rates, and national ID/iqama number,
-- and every payroll run's per-employee gross/net pay and GOSI amounts.
--
-- Two view permissions per area, same split as inventory.items.view_cost
-- (0085) and accounting.reports.stock_valuation.view_cost (0089): a base
-- "can see this exists" permission, and a separate "can see the money/PII
-- fields" permission for the compensation-sensitive columns specifically.
-- Departments and positions (plain reference data, no sensitive fields)
-- ride on the employee view permission, same as item reference data
-- (brands/categories/etc.) rode on inventory.items.view in 0085 -- no
-- cross-module caller depends on them, so no separate code is needed.
--
-- Backfilled to every currently-active role, not just roles that already
-- hold hr.employee.manage/hr.payroll.post: since no masking existed
-- before this migration, every role could already see all of this,
-- so deploying it must not hide anything anyone could see yesterday.

INSERT INTO permissions (module, action, code, description) VALUES
  ('hr', 'view_employee', 'hr.employee.view', 'View employees, departments, and positions'),
  ('hr', 'view_employee_salary', 'hr.employee.view_salary', 'View an employee''s salary, allowances, GOSI rates, and national ID/iqama'),
  ('hr', 'view_payroll', 'hr.payroll.view', 'View payroll runs (dates and status, not amounts)'),
  ('hr', 'view_payroll_salary', 'hr.payroll.view_salary', 'View a payroll run''s per-employee pay, deductions, and national ID/iqama');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.code IN (
  'hr.employee.view', 'hr.employee.view_salary', 'hr.payroll.view', 'hr.payroll.view_salary'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;
