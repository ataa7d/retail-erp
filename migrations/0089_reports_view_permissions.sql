-- Phase 4 of read-access permissions (see 0085's comment for the full
-- rationale): splits the single accounting.reports.view umbrella (0047)
-- into one view permission per report screen, same shape as 0084's
-- "split manage permissions" migration -- new permissions, carry forward
-- every role's existing *effective* access (everyone who held the old
-- permission gets every new one), then retire the old permission.
--
-- Stock Valuation additionally gets its own view_cost permission: it's
-- the one report in this module that returns per-unit cost
-- (avg_unit_cost) and a cost-derived total (total_value) alongside plain
-- quantities, the same split already applied to Items/Purchasing's cost
-- columns in migration 0085 (inventory.items.view_cost). A role can see
-- the quantities/value-by-location shape of this report without being
-- able to see unit cost. Since no masking existed before this migration,
-- view_cost is backfilled to the same roles as the base view permission
-- so nobody loses access they already had.

INSERT INTO permissions (module, action, code, description) VALUES
  ('accounting', 'view_trial_balance', 'accounting.reports.trial_balance.view', 'View the trial balance report'),
  ('accounting', 'view_income_statement', 'accounting.reports.income_statement.view', 'View the income statement report'),
  ('accounting', 'view_balance_sheet', 'accounting.reports.balance_sheet.view', 'View the balance sheet report'),
  ('accounting', 'view_customer_statement', 'accounting.reports.customer_statement.view', 'View customer account statements'),
  ('accounting', 'view_stock_valuation', 'accounting.reports.stock_valuation.view', 'View the stock valuation report (quantities and total value)'),
  ('accounting', 'view_stock_valuation_cost', 'accounting.reports.stock_valuation.view_cost', 'View per-unit average cost in the stock valuation report'),
  ('accounting', 'view_budget_vs_actual', 'accounting.reports.budget_vs_actual.view', 'View the budget vs actual report'),
  ('accounting', 'view_vat_summary', 'accounting.reports.vat_summary.view', 'View the VAT summary report');

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions old ON old.id = rp.permission_id AND old.code = 'accounting.reports.view'
CROSS JOIN (
  SELECT id FROM permissions WHERE code IN (
    'accounting.reports.trial_balance.view', 'accounting.reports.income_statement.view',
    'accounting.reports.balance_sheet.view', 'accounting.reports.customer_statement.view',
    'accounting.reports.stock_valuation.view', 'accounting.reports.stock_valuation.view_cost',
    'accounting.reports.budget_vs_actual.view', 'accounting.reports.vat_summary.view'
  )
) p
ON CONFLICT (role_id, permission_id) DO NOTHING;

DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE code = 'accounting.reports.view');
DELETE FROM permissions WHERE code = 'accounting.reports.view';
