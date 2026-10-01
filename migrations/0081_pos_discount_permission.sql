-- Gates who is allowed to authorize a POS discount (via step-up auth, see
-- src/api/routes/auth.ts verify-step-up) -- distinct from
-- sales.pos_invoice.create, since every cashier has that but a discount
-- needs a manager/supervisor.
INSERT INTO permissions (module, action, code, description) VALUES
  ('sales', 'discount_pos_invoice', 'sales.pos_invoice.discount', 'Authorize a discount on a POS sale');
