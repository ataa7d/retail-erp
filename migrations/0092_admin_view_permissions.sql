-- Phase 7 (final) of read-access permissions (see 0085's comment for the
-- full rationale): Admin. Unlike every prior module, most of Admin was
-- already gated -- admin.ts's users/roles/permissions/audit-log routes
-- all require admin.users.manage, admin.roles.manage, or
-- admin.audit_log.view already. The gaps here are narrower:
--
-- 1. GET /admin/users, GET /admin/users/:id (currently admin.users.manage)
--    and GET /admin/permissions, GET /admin/roles (currently
--    admin.roles.manage) bundle viewing with every write action, so a
--    read-only "can see the user/role list" role isn't possible today --
--    same create/edit vs. view split already applied everywhere else in
--    this project (e.g. 0084's manage-permission splits). Two new view
--    permissions, backfilled only to roles that already hold the
--    corresponding manage permission (not every active role): unlike
--    every other gap this project has closed, these GETs were already
--    restricted to admin.users.manage/admin.roles.manage holders, so
--    there's no wider existing access to preserve.
-- 2. GET /branches and the 3 zatca-onboarding GETs (readiness, compliance
--    checks, the onboarding record itself) are, unlike the rest of
--    admin.ts, completely ungated (authenticate only) -- confirmed via
--    caller audit that neither is used outside Admin.tsx. Two new view
--    permissions, backfilled to every active role since these were
--    previously open to any authenticated user.
--
-- Deliberately NOT touched: GET /companies (pre-company-selection picker,
-- intentionally authenticateUser-only, not even this company's
-- authenticate), GET /companies/current (seller details every invoice
-- print and VAT calc across Sales/POS/HR depends on), GET /stores and
-- GET /pos-devices (shared lookups -- store pickers everywhere, and the
-- POS login screen's device picker for ordinary cashiers, not just
-- admins) -- gating any of these would break operational flows outside
-- Admin entirely, same reasoning as /customers and /tax-codes earlier
-- in this project.

INSERT INTO permissions (module, action, code, description) VALUES
  ('admin', 'view_users', 'admin.users.view', 'View the user list and user detail without managing them'),
  ('admin', 'view_roles', 'admin.roles.view', 'View roles and the permission catalog without managing them'),
  ('admin', 'view_branches', 'admin.branches.view', 'View branches and stores in Administration'),
  ('admin', 'view_zatca_onboarding', 'admin.zatca_onboarding.view', 'View ZATCA onboarding status, compliance checks, and readiness');

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions old ON old.id = rp.permission_id AND old.code = 'admin.users.manage'
CROSS JOIN (SELECT id FROM permissions WHERE code = 'admin.users.view') p
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions old ON old.id = rp.permission_id AND old.code = 'admin.roles.manage'
CROSS JOIN (SELECT id FROM permissions WHERE code = 'admin.roles.view') p
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.code IN ('admin.branches.view', 'admin.zatca_onboarding.view')
ON CONFLICT (role_id, permission_id) DO NOTHING;
