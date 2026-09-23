-- The inventory ledger. Current stock is never a mutable counter — it is
-- always SUM(qty) over this table, optionally cached in stock_balances
-- (0025), which is trigger-maintained and independently rebuildable, never
-- patched with a blind increment.

CREATE TYPE stock_movement_type AS ENUM (
  'receipt', 'issue', 'transfer_out', 'transfer_in',
  'adjustment_in', 'adjustment_out', 'sales_return', 'stocktake_variance'
);

CREATE TABLE stock_movements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  store_id          UUID NOT NULL REFERENCES stores(id),
  item_variant_id   UUID NOT NULL REFERENCES item_variants(id),
  movement_type     stock_movement_type NOT NULL,
  qty               NUMERIC(14,3) NOT NULL CHECK (qty <> 0), -- signed: positive = in, negative = out
  unit_cost         NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0), -- set by trigger; caller value only used as a hint for incoming movements
  total_cost        NUMERIC(14,2) NOT NULL DEFAULT 0,
  reason_code       TEXT,
  source_type       TEXT NOT NULL, -- 'sales_invoice', 'credit_note', 'transfer', 'adjustment', 'stocktake'
  source_id         UUID,
  source_line_id    UUID, -- e.g. the specific sales_invoice_line, for cost traceability on returns
  linked_movement_id UUID REFERENCES stock_movements(id), -- transfer_in points at its transfer_out
  movement_at       TIMESTAMPTZ NOT NULL DEFAULT now(), -- business date/time (can be backdated for a stocktake)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),  -- insertion order, authoritative for weighted-average sequencing
  created_by        UUID REFERENCES users(id),
  CHECK (total_cost = ROUND(qty * unit_cost, 2)),
  CHECK (
    (movement_type IN ('receipt', 'transfer_in', 'adjustment_in', 'sales_return') AND qty > 0) OR
    (movement_type IN ('issue', 'transfer_out', 'adjustment_out') AND qty < 0) OR
    (movement_type = 'stocktake_variance') -- variance can go either way
  ),
  CHECK (
    (movement_type IN ('adjustment_in', 'adjustment_out') AND reason_code IS NOT NULL) OR
    (movement_type NOT IN ('adjustment_in', 'adjustment_out'))
  )
);

CREATE INDEX idx_stock_movements_company ON stock_movements(company_id);
CREATE INDEX idx_stock_movements_store_variant ON stock_movements(store_id, item_variant_id);
CREATE INDEX idx_stock_movements_source ON stock_movements(source_type, source_id);
CREATE INDEX idx_stock_movements_created_at ON stock_movements(created_at);

CREATE OR REPLACE FUNCTION check_stock_movement_refs_company()
RETURNS TRIGGER AS $$
DECLARE
  ref_company_id UUID;
BEGIN
  SELECT company_id INTO ref_company_id FROM stores WHERE id = NEW.store_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'store % does not belong to company %', NEW.store_id, NEW.company_id;
  END IF;

  SELECT company_id INTO ref_company_id FROM item_variants WHERE id = NEW.item_variant_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'item_variant % does not belong to company %', NEW.item_variant_id, NEW.company_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_movements_check_refs
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION check_stock_movement_refs_company();

-- Append-only: no movement is ever edited or deleted. Corrections are new,
-- opposite movements (a reversing adjustment), same principle as posted
-- documents elsewhere in this schema.
CREATE OR REPLACE FUNCTION check_stock_movement_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'stock movements are append-only (movement %)', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_movements_immutable
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION check_stock_movement_immutable();

CREATE TRIGGER trg_stock_movements_audit
  AFTER INSERT OR UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
