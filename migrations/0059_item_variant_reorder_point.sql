-- Reorder point per variant: 0 (the default) means "no alert threshold set"
-- rather than "reorder immediately" -- a variant only shows up as low stock
-- once someone opts it in by setting a positive value. Company-wide, not
-- per-store, matching how the rest of item master data works; a business
-- that wants per-store thresholds would need a separate table, not needed
-- yet.

ALTER TABLE item_variants
  ADD COLUMN reorder_point NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (reorder_point >= 0);
