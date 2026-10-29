-- CRM richer profile (notes, tags, purchase history is a query, not a
-- column), loyalty tiers (earn-multiplier only, no reward catalog), and
-- a communication log first populated by the new WhatsApp invoice send.

-- ---- Richer customer profile ----

-- Append-only, unlike the one-off `notes TEXT` columns on documents
-- elsewhere (requisitions, quotations, etc.) -- a customer accumulates
-- notes over its lifetime, it doesn't overwrite one field.
CREATE TABLE customer_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id),
  customer_id     UUID NOT NULL REFERENCES customers(id),
  author_user_id  UUID REFERENCES users(id),
  note            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_notes_customer ON customer_notes(customer_id);

-- Lightweight segmentation (VIP, frequent-buyer, ...) -- a plain array
-- rather than a tags/join table, since this is label-only, no per-tag
-- metadata.
ALTER TABLE customers ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';

-- ---- Loyalty tiers (earn-multiplier only; no redeemable reward catalog) ----

CREATE TABLE loyalty_tiers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id),
  name                TEXT NOT NULL,
  min_lifetime_points INTEGER NOT NULL CHECK (min_lifetime_points >= 0),
  earn_multiplier     NUMERIC(4,2) NOT NULL DEFAULT 1 CHECK (earn_multiplier > 0),
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE INDEX idx_loyalty_tiers_company ON loyalty_tiers(company_id);

-- Tracks points ever earned, never decremented by redemption -- tier
-- standing must survive a member spending their points, unlike
-- loyalty_points_balance which drops on redeem.
ALTER TABLE customers ADD COLUMN lifetime_points_earned INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_points_earned >= 0);
ALTER TABLE customers ADD COLUMN loyalty_tier_id UUID REFERENCES loyalty_tiers(id);

-- ---- Communication log ----

CREATE TABLE customer_communications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id),
  customer_id     UUID NOT NULL REFERENCES customers(id),
  channel         TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email', 'sms')),
  reference_type  TEXT NOT NULL,
  reference_id    UUID NOT NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error           TEXT,
  sent_by         UUID REFERENCES users(id)
);

CREATE INDEX idx_customer_communications_customer ON customer_communications(customer_id);

-- ---- Permissions for the new actions ----
-- Granted to every current role on deploy, same no-regression backfill
-- 0084/0085 used: these are brand-new actions nobody could do before,
-- but a fresh company's Administrator role (which gets every permission
-- row, see companyBootstrapService.ts) must not silently lag an
-- existing one just because it was created a migration earlier.

INSERT INTO permissions (module, action, code, description) VALUES
  ('sales', 'manage_customer_notes', 'sales.customer.notes.manage', 'Add notes to a customer'),
  ('sales', 'manage_customer_tags', 'sales.customer.tags.manage', 'Set a customer''s tags'),
  ('sales', 'view_customer_purchase_history', 'sales.customer.purchase_history.view', 'View a customer''s order history'),
  ('sales', 'manage_loyalty_tiers', 'sales.loyalty_tier.manage', 'Create and edit loyalty tiers'),
  ('sales', 'send_customer_whatsapp', 'sales.customer.send_whatsapp', 'Send a sales invoice to a customer via WhatsApp');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.code IN (
  'sales.customer.notes.manage', 'sales.customer.tags.manage', 'sales.customer.purchase_history.view',
  'sales.loyalty_tier.manage', 'sales.customer.send_whatsapp'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;
