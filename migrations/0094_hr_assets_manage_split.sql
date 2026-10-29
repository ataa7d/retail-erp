-- Granularity cleanup, continuing from 0093: HR and Fixed Assets' write
-- permissions bundle disparate-severity actions the same way
-- inventory.items.manage did before 0084 split it.
--
-- hr.employee.manage currently gates both hiring/setup (create
-- department, create position, create employee) and termination -- a
-- final, irreversible action on a person's record, a meaningfully
-- different risk tier from setting up a department. Split into
-- hr.employee.create (setup + hiring) and hr.employee.terminate, full
-- split-and-retire like 0084.
--
-- assets.fixed_asset.manage has the identical shape: create asset
-- category + acquire asset (setup) vs. dispose (a terminal action that
-- removes an asset and books a gain/loss). Split into
-- assets.fixed_asset.create and assets.fixed_asset.dispose, same
-- split-and-retire.
--
-- hr.payroll.post and assets.depreciation.post are a narrower case: each
-- already has a distinctly-named action (post/bulk-post, which commits
-- pay or depreciation to the GL), but that same code also gates creating
-- a draft run -- a lower-stakes staging step with no GL impact until
-- posted, the same draft/posted lifecycle Purchase Orders and other
-- documents already separate by permission elsewhere in this project.
-- Rather than retiring the .post code (nothing else references it under
-- a misleading name, unlike .manage), this just narrows what it gates
-- and adds a new .create permission for the draft-creation step, carried
-- forward to every role that already holds .post so nobody loses the
-- ability to create a run they could already create.

INSERT INTO permissions (module, action, code, description) VALUES
  ('hr', 'create_employee', 'hr.employee.create', 'Create departments, positions, and employees'),
  ('hr', 'terminate_employee', 'hr.employee.terminate', 'Terminate an employee'),
  ('hr', 'create_payroll_run', 'hr.payroll.create', 'Create a draft payroll run'),
  ('assets', 'create_fixed_asset', 'assets.fixed_asset.create', 'Create asset categories and acquire fixed assets'),
  ('assets', 'dispose_fixed_asset', 'assets.fixed_asset.dispose', 'Dispose a fixed asset'),
  ('assets', 'create_depreciation_run', 'assets.depreciation.create', 'Create a draft depreciation run');

-- hr.employee.manage -> create / terminate (full split-and-retire)
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions old ON old.id = rp.permission_id AND old.code = 'hr.employee.manage'
CROSS JOIN (SELECT id FROM permissions WHERE code IN ('hr.employee.create', 'hr.employee.terminate')) p
ON CONFLICT (role_id, permission_id) DO NOTHING;

DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE code = 'hr.employee.manage');
DELETE FROM permissions WHERE code = 'hr.employee.manage';

-- assets.fixed_asset.manage -> create / dispose (full split-and-retire)
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions old ON old.id = rp.permission_id AND old.code = 'assets.fixed_asset.manage'
CROSS JOIN (SELECT id FROM permissions WHERE code IN ('assets.fixed_asset.create', 'assets.fixed_asset.dispose')) p
ON CONFLICT (role_id, permission_id) DO NOTHING;

DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE code = 'assets.fixed_asset.manage');
DELETE FROM permissions WHERE code = 'assets.fixed_asset.manage';

-- hr.payroll.post keeps gating post/bulk-post; every current holder also
-- gets the new create permission so nobody loses the ability to create a
-- draft run they already had.
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions old ON old.id = rp.permission_id AND old.code = 'hr.payroll.post'
CROSS JOIN (SELECT id FROM permissions WHERE code = 'hr.payroll.create') p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- assets.depreciation.post keeps gating post/bulk-post; same backfill.
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions old ON old.id = rp.permission_id AND old.code = 'assets.depreciation.post'
CROSS JOIN (SELECT id FROM permissions WHERE code = 'assets.depreciation.create') p
ON CONFLICT (role_id, permission_id) DO NOTHING;
