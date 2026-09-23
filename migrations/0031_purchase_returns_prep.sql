-- Add a movement type for goods physically returned to a supplier, and
-- widen the sign-check constraint to include it (outgoing, qty < 0).
-- Postgres requires ALTER TYPE ... ADD VALUE to commit before the new
-- value can be used, so this is its own migration ahead of
-- supplier_credit_notes (0032), which is the first thing to use it.

ALTER TYPE stock_movement_type ADD VALUE 'purchase_return';
