-- Phase 6 of read-access permissions (see 0085's comment for the full
-- rationale): Fixed Assets. Every GET route in fixedAssets.ts currently
-- has no permission check at all -- any authenticated user can read
-- every asset's acquisition_cost, salvage_value, accumulated_depreciation,
-- and disposal_proceeds, and every depreciation run's per-asset
-- depreciation_amount.
--
-- Same split as inventory.items.view_cost (0085), stock_valuation's
-- (0089), and HR's salary split (0090): a base "can see this exists"
-- permission, and a separate "can see the money fields" permission for
-- the cost-sensitive columns. Asset categories (plain reference data, no
-- money) ride on the asset view permission, same as item reference data
-- did in 0085.
--
-- Backfilled to every currently-active role, not just roles that already
-- hold assets.fixed_asset.manage/assets.depreciation.post: since no
-- masking existed before this migration, every role could already see
-- all of this, so deploying it must not hide anything anyone could see
-- yesterday.

INSERT INTO permissions (module, action, code, description) VALUES
  ('assets', 'view_fixed_asset', 'assets.fixed_asset.view', 'View fixed assets and asset categories'),
  ('assets', 'view_fixed_asset_cost', 'assets.fixed_asset.view_cost', 'View a fixed asset''s acquisition cost, salvage value, and accumulated depreciation'),
  ('assets', 'view_depreciation', 'assets.depreciation.view', 'View depreciation runs'),
  ('assets', 'view_depreciation_cost', 'assets.depreciation.view_cost', 'View per-asset depreciation amounts in a depreciation run');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.code IN (
  'assets.fixed_asset.view', 'assets.fixed_asset.view_cost',
  'assets.depreciation.view', 'assets.depreciation.view_cost'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;
