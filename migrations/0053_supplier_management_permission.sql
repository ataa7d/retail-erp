-- No permission in the original catalog (0010) covers creating/editing
-- suppliers or their quoted item prices -- purchasing.po.create is about
-- placing orders, not supplier master data. Adding the one genuinely
-- missing permission rather than overloading an unrelated one (same
-- reasoning as 0050/0051).
INSERT INTO permissions (module, action, code, description) VALUES
  ('purchasing', 'manage_suppliers', 'purchasing.supplier.manage', 'Create/edit suppliers and their quoted item prices');
