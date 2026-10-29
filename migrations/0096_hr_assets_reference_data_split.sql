-- Granularity cleanup, found on re-audit after 0093/0094/0095:
-- hr.employee.create and assets.fixed_asset.create each still bundle
-- reference/config-data setup with the actual PII/financial-creating
-- action, the same smell this project has repeatedly fixed.
--
-- hr.employee.create gates POST /departments, POST /positions (zero-risk
-- organizational metadata -- just labels) AND POST /employees (creates
-- a record carrying national ID/iqama, basic salary, allowances, GOSI
-- rates). A role that sets up org structure doesn't need to be trusted
-- with entering someone's salary and national ID.
--
-- assets.fixed_asset.create gates POST /asset-categories (config data --
-- GL account mappings a category uses, comparable to brands/categories
-- in the Items module, which ride on a reference-data permission
-- distinct from inventory.items.create) AND POST /fixed-assets (a real
-- financial transaction: creates an asset with an actual acquisition
-- cost and starts a depreciation schedule).
--
-- Narrowing, not full split-and-retire (like 0094's .post narrowing):
-- hr.employee.create keeps gating employee creation; a new
-- hr.org_structure.manage takes over departments/positions.
-- assets.fixed_asset.create keeps gating asset acquisition; a new
-- assets.asset_category.manage takes over asset categories. Every role
-- that already held the narrowed permission gets the new one too, so
-- nobody loses the ability to do something they could already do.

INSERT INTO permissions (module, action, code, description) VALUES
  ('hr', 'manage_org_structure', 'hr.org_structure.manage', 'Create departments and positions'),
  ('assets', 'manage_asset_category', 'assets.asset_category.manage', 'Create asset categories');

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions old ON old.id = rp.permission_id AND old.code = 'hr.employee.create'
CROSS JOIN (SELECT id FROM permissions WHERE code = 'hr.org_structure.manage') p
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions old ON old.id = rp.permission_id AND old.code = 'assets.fixed_asset.create'
CROSS JOIN (SELECT id FROM permissions WHERE code = 'assets.asset_category.manage') p
ON CONFLICT (role_id, permission_id) DO NOTHING;
