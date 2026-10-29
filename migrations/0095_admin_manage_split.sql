-- Granularity cleanup, continuing from 0093/0094: Admin's write
-- permissions bundle disparate-severity actions, the same smell 0084
-- fixed for inventory.items.manage and friends -- but more consequential
-- here, since admin.roles.manage in particular bundles creating an empty
-- role with assigning arbitrary permissions to a role (the actual
-- privilege-escalation surface in this system) and deactivating a role
-- (which, since the role-deactivation fix, immediately revokes it from
-- every holder).
--
-- admin.users.manage -> admin.users.invite (POST /admin/users),
-- admin.users.assign_roles (POST /admin/users/:id/roles and .../remove
-- -- granting/revoking a user's role assignments, itself a privilege
-- lever since a role carries whatever permissions it holds), and
-- admin.users.deactivate (POST /admin/users/:id/deactivate and
-- /reactivate, one permission for the toggle pair, same as
-- inventory.items.deactivate in 0084). Full split-and-retire.
--
-- admin.roles.manage -> admin.roles.create (POST /admin/roles, which
-- only creates an empty, permission-less role), admin.roles.
-- assign_permissions (POST /admin/roles/:id/permissions -- the
-- privilege-escalation surface itself, separated out so it can be
-- granted far more narrowly than "can administer roles at all"), and
-- admin.roles.deactivate (the deactivate/reactivate toggle pair). Full
-- split-and-retire.

INSERT INTO permissions (module, action, code, description) VALUES
  ('admin', 'invite_user', 'admin.users.invite', 'Invite a new user or grant an existing user access to this company'),
  ('admin', 'assign_user_roles', 'admin.users.assign_roles', 'Assign or remove a user''s role assignments'),
  ('admin', 'deactivate_user', 'admin.users.deactivate', 'Deactivate or reactivate a user''s access to this company'),
  ('admin', 'create_role', 'admin.roles.create', 'Create a new, permission-less role'),
  ('admin', 'assign_role_permissions', 'admin.roles.assign_permissions', 'Set which permissions a role grants'),
  ('admin', 'deactivate_role', 'admin.roles.deactivate', 'Deactivate or reactivate a role');

-- admin.users.manage -> invite / assign_roles / deactivate
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions old ON old.id = rp.permission_id AND old.code = 'admin.users.manage'
CROSS JOIN (
  SELECT id FROM permissions WHERE code IN ('admin.users.invite', 'admin.users.assign_roles', 'admin.users.deactivate')
) p
ON CONFLICT (role_id, permission_id) DO NOTHING;

DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE code = 'admin.users.manage');
DELETE FROM permissions WHERE code = 'admin.users.manage';

-- admin.roles.manage -> create / assign_permissions / deactivate
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions old ON old.id = rp.permission_id AND old.code = 'admin.roles.manage'
CROSS JOIN (
  SELECT id FROM permissions WHERE code IN ('admin.roles.create', 'admin.roles.assign_permissions', 'admin.roles.deactivate')
) p
ON CONFLICT (role_id, permission_id) DO NOTHING;

DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE code = 'admin.roles.manage');
DELETE FROM permissions WHERE code = 'admin.roles.manage';
