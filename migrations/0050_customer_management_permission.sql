-- No permission in the original catalog (0010) covers creating/editing
-- customers specifically -- inventory.items.manage is the closest but is
-- about items, not customer master data. Adding the one genuinely missing
-- permission rather than overloading an unrelated one.
INSERT INTO permissions (module, action, code, description) VALUES
  ('sales', 'manage_customers', 'sales.customer.manage', 'Create and edit customers');
