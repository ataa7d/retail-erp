-- Granularity cleanup, discovered on review of the read-access
-- permissions project: accounting.ageing.view (0088, Phase 3) bundles
-- GET /ar-ageing and GET /ap-ageing into one permission, unlike every
-- other document-type split in this project (Sales' invoice vs. credit
-- note vs. gift card, Purchasing's requisition vs. PO vs. goods receipt,
-- etc.). AR ageing is a collections/receivables concern; AP ageing is a
-- payables/procurement concern -- different job functions, the same
-- reasoning that drove every other per-document-type split here.
--
-- Same split-and-retire shape as 0084 and 0089: two new permissions,
-- carry forward every role's existing effective access (everyone who
-- held the old permission gets both new ones), then retire the old one.

INSERT INTO permissions (module, action, code, description) VALUES
  ('accounting', 'view_ar_ageing', 'accounting.ar_ageing.view', 'View the AR ageing report'),
  ('accounting', 'view_ap_ageing', 'accounting.ap_ageing.view', 'View the AP ageing report');

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions old ON old.id = rp.permission_id AND old.code = 'accounting.ageing.view'
CROSS JOIN (
  SELECT id FROM permissions WHERE code IN ('accounting.ar_ageing.view', 'accounting.ap_ageing.view')
) p
ON CONFLICT (role_id, permission_id) DO NOTHING;

DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE code = 'accounting.ageing.view');
DELETE FROM permissions WHERE code = 'accounting.ageing.view';
