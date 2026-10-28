-- Splits three "manage" permissions that bundled create + edit + deactivate
-- into one grant each -- too coarse to assign a role that, say, edits item
-- prices but shouldn't be able to deactivate an item, or creates suppliers
-- but shouldn't edit an existing one's payment terms. Every other instance
-- of a bundled "manage" permission in the catalog is left alone for now;
-- this is the first of what will likely be several such splits.
--
-- For each role currently holding the old umbrella permission, this grants
-- every new split permission to that same role before removing the old
-- one, so no one's effective access changes the moment this migration
-- runs -- an admin can then tighten each role's grants deliberately
-- afterward (Administration > Roles).

INSERT INTO permissions (module, action, code, description) VALUES
  ('inventory', 'create_items', 'inventory.items.create', 'Create items, variants, and bulk-import'),
  ('inventory', 'edit_items', 'inventory.items.edit', 'Edit item classification, reorder points, attributes, and barcodes'),
  ('inventory', 'deactivate_items', 'inventory.items.deactivate', 'Deactivate or reactivate item variants'),
  ('purchasing', 'create_supplier', 'purchasing.supplier.create', 'Create suppliers'),
  ('purchasing', 'edit_supplier', 'purchasing.supplier.edit', 'Edit suppliers and their quoted item prices'),
  ('purchasing', 'deactivate_supplier', 'purchasing.supplier.deactivate', 'Deactivate or reactivate suppliers'),
  ('sales', 'create_customer', 'sales.customer.create', 'Create customers'),
  ('sales', 'edit_customer', 'sales.customer.edit', 'Edit customer payment terms and loyalty balance');

-- inventory.items.manage -> create / edit / deactivate
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions old ON old.id = rp.permission_id AND old.code = 'inventory.items.manage'
CROSS JOIN (SELECT id FROM permissions WHERE code IN ('inventory.items.create', 'inventory.items.edit', 'inventory.items.deactivate')) p
ON CONFLICT (role_id, permission_id) DO NOTHING;

DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE code = 'inventory.items.manage');
DELETE FROM permissions WHERE code = 'inventory.items.manage';

-- purchasing.supplier.manage -> create / edit / deactivate
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions old ON old.id = rp.permission_id AND old.code = 'purchasing.supplier.manage'
CROSS JOIN (SELECT id FROM permissions WHERE code IN ('purchasing.supplier.create', 'purchasing.supplier.edit', 'purchasing.supplier.deactivate')) p
ON CONFLICT (role_id, permission_id) DO NOTHING;

DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE code = 'purchasing.supplier.manage');
DELETE FROM permissions WHERE code = 'purchasing.supplier.manage';

-- sales.customer.manage -> create / edit
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions old ON old.id = rp.permission_id AND old.code = 'sales.customer.manage'
CROSS JOIN (SELECT id FROM permissions WHERE code IN ('sales.customer.create', 'sales.customer.edit')) p
ON CONFLICT (role_id, permission_id) DO NOTHING;

DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE code = 'sales.customer.manage');
DELETE FROM permissions WHERE code = 'sales.customer.manage';
