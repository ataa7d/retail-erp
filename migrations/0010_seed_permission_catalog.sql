-- System-wide permission catalog. This is reference data (part of the
-- application, not per-environment), so it belongs in a migration, not the
-- seed script. Expanded in later phases as new modules add actions.

INSERT INTO permissions (module, action, code, description) VALUES
  ('admin', 'manage_users', 'admin.users.manage', 'Create, edit, deactivate users'),
  ('admin', 'manage_roles', 'admin.roles.manage', 'Create, edit roles and permission assignments'),
  ('admin', 'manage_companies', 'admin.companies.manage', 'Create, edit companies and branches'),
  ('admin', 'view_audit_log', 'admin.audit_log.view', 'View the audit trail'),
  ('accounting', 'manage_chart_of_accounts', 'accounting.coa.manage', 'Create, edit chart of accounts'),
  ('accounting', 'manage_fiscal_periods', 'accounting.fiscal_periods.manage', 'Open/close fiscal years and periods'),
  ('accounting', 'post_journal', 'accounting.journal.post', 'Post manual journal entries'),
  ('sales', 'create_pos_invoice', 'sales.pos_invoice.create', 'Create POS invoices'),
  ('sales', 'create_wholesale_invoice', 'sales.wholesale_invoice.create', 'Create wholesale invoices'),
  ('sales', 'create_return', 'sales.return.create', 'Create sales returns / credit notes'),
  ('sales', 'void_document', 'sales.document.void', 'Void an unposted sales document'),
  ('inventory', 'manage_items', 'inventory.items.manage', 'Create, edit items and variants'),
  ('inventory', 'post_adjustment', 'inventory.adjustment.post', 'Post stock adjustments'),
  ('inventory', 'post_transfer', 'inventory.transfer.post', 'Post stock transfers between stores'),
  ('purchasing', 'create_purchase_order', 'purchasing.po.create', 'Create purchase orders'),
  ('purchasing', 'post_goods_receipt', 'purchasing.goods_receipt.post', 'Post goods receipts');
