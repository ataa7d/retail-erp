-- Phase 3 of read-access permissions (see 0085's comment for the full
-- rationale): same pattern, this time for Accounting's screens. One view
-- permission per screen/tab, backfilled to every currently-active role so
-- deploying this never silently hides something a role could already see.
--
-- Two of these (sales.customer.view, sales.loyalty_tier.view) are in the
-- `sales` module rather than `accounting` because the entities they view
-- (customers, loyalty tiers) already have their write permissions there
-- (sales.customer.create/edit, sales.loyalty_tier.manage) -- the Accounting
-- tab is just where their screens happen to live in the sidebar.
--
-- Deliberately NOT gating GET /customers, GET /tax-codes, GET
-- /loyalty-tiers, or GET /exchange-rates/lookup -- confirmed via caller
-- audit these are shared lookups other already-permissioned modules
-- depend on regardless of whether the caller can see Accounting's own
-- management screen for that data: /customers is POS's checkout
-- phone-match list, /tax-codes backs every tax-code dropdown in
-- Items/Sales/Purchasing, /loyalty-tiers backs the Customers page's tier
-- panel, and /exchange-rates/lookup backs multi-currency conversion in
-- Sales/Purchasing/Dashboard. GET /exchange-rates (the full rate list/
-- management screen, a different endpoint) IS gated below -- only the
-- Accounting FX tab calls it.

INSERT INTO permissions (module, action, code, description) VALUES
  ('accounting', 'view_coa', 'accounting.coa.view', 'View the chart of accounts'),
  ('accounting', 'view_fiscal_period', 'accounting.fiscal_period.view', 'View fiscal years and periods'),
  ('accounting', 'view_bank_account', 'accounting.bank_account.view', 'View bank accounts'),
  ('accounting', 'view_journal', 'accounting.journal.view', 'View journal entries'),
  ('accounting', 'view_receipt', 'accounting.receipt.view', 'View customer receipts'),
  ('accounting', 'view_payment', 'accounting.payment.view', 'View supplier payments'),
  ('accounting', 'view_ageing', 'accounting.ageing.view', 'View AR/AP ageing reports'),
  ('accounting', 'view_bank_reconciliation', 'accounting.bank_reconciliation.view', 'View bank reconciliations and statement lines'),
  ('accounting', 'view_budget', 'accounting.budget.view', 'View budgets'),
  ('accounting', 'view_exchange_rate', 'accounting.exchange_rate.view', 'View the exchange rate list'),
  ('accounting', 'view_tax_code', 'accounting.tax_code.view', 'View tax codes (Accounting screen; create/sales/purchasing dropdowns stay open)'),
  ('sales', 'view_customer', 'sales.customer.view', 'View the customer list and detail screen'),
  ('sales', 'view_loyalty_tier', 'sales.loyalty_tier.view', 'View loyalty tiers (Accounting screen; the Customers tier panel stays open)');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.code IN (
  'accounting.coa.view', 'accounting.fiscal_period.view', 'accounting.bank_account.view',
  'accounting.journal.view', 'accounting.receipt.view', 'accounting.payment.view',
  'accounting.ageing.view', 'accounting.bank_reconciliation.view', 'accounting.budget.view',
  'accounting.exchange_rate.view', 'accounting.tax_code.view',
  'sales.customer.view', 'sales.loyalty_tier.view'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;
