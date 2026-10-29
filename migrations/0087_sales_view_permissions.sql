-- Phase 2 of read-access permissions (see 0085's comment for the full
-- rationale): same pattern, this time for Sales' core documents. Unlike
-- write actions (which split sales.pos_invoice.create vs
-- sales.wholesale_invoice.create by channel), viewing is one permission
-- covering both channels -- GET /sales-invoices returns them mixed in one
-- list, and splitting the read side by channel would need per-row
-- filtering for no real benefit (a role that can see POS sales but not
-- wholesale ones isn't a realistic job split the way "can post a
-- wholesale invoice" vs "can ring up a POS sale" is).
--
-- Deliberately NOT gating GET /customers, /price-lists, or the
-- transactional lookup endpoints (/gift-cards/lookup,
-- /customer-deposits/lookup) -- confirmed via caller audit these are
-- shared lookups other modules' already-permissioned flows depend on
-- (POS checkout, Accounting's payment form, Dashboard, Items' barcode
-- labels), same reasoning as /items and /suppliers in migration 0085.

INSERT INTO permissions (module, action, code, description) VALUES
  ('sales', 'view_invoice', 'sales.invoice.view', 'View sales invoices (POS and wholesale)'),
  ('sales', 'view_quotation', 'sales.quotation.view', 'View sales quotations'),
  ('sales', 'view_credit_note', 'sales.credit_note.view', 'View credit notes'),
  ('sales', 'view_gift_card', 'sales.gift_card.view', 'View the gift card register'),
  ('sales', 'view_deposit', 'sales.deposit.view', 'View customer deposits');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.code IN (
  'sales.invoice.view', 'sales.quotation.view', 'sales.credit_note.view',
  'sales.gift_card.view', 'sales.deposit.view'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;
