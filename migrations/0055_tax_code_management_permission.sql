-- No permission in the original catalog (0010) covers creating/editing tax
-- codes -- accounting.coa.manage is about the chart of accounts, not VAT
-- rates. Adding the one genuinely missing permission rather than
-- overloading an unrelated one (same reasoning as 0050/0051/0053).
INSERT INTO permissions (module, action, code, description) VALUES
  ('accounting', 'manage_tax_codes', 'accounting.tax_code.manage', 'Create and edit tax codes (VAT rates)');
