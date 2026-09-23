-- Materialized current-stock cache, one row per (store, item_variant).
-- Maintained exclusively by trg_stock_movements_process below (never a
-- blind "qty = qty + x") and independently reproducible from the ledger
-- via fn_rebuild_stock_balance — the two are proven to agree in tests.

CREATE TABLE stock_balances (
  company_id        UUID NOT NULL REFERENCES companies(id),
  store_id          UUID NOT NULL REFERENCES stores(id),
  item_variant_id   UUID NOT NULL REFERENCES item_variants(id),
  qty_on_hand       NUMERIC(14,3) NOT NULL DEFAULT 0,
  avg_unit_cost     NUMERIC(14,4) NOT NULL DEFAULT 0,
  total_value       NUMERIC(14,2) NOT NULL DEFAULT 0,
  last_movement_at  TIMESTAMPTZ,
  PRIMARY KEY (store_id, item_variant_id)
);

CREATE INDEX idx_stock_balances_company ON stock_balances(company_id);

-- The write path for every stock movement: determines the movement's real
-- unit_cost (outgoing = current average, always; incoming = caller's cost
-- if given, else current average) and folds it into the running weighted
-- average, all under a row lock on the balance so concurrent movements for
-- the same store+variant serialize instead of racing.
CREATE OR REPLACE FUNCTION fn_process_stock_movement()
RETURNS TRIGGER AS $$
DECLARE
  v_current_qty NUMERIC(14,3);
  v_current_avg NUMERIC(14,4);
  v_new_qty NUMERIC(14,3);
  v_new_avg NUMERIC(14,4);
BEGIN
  INSERT INTO stock_balances (company_id, store_id, item_variant_id, qty_on_hand, avg_unit_cost, total_value)
  VALUES (NEW.company_id, NEW.store_id, NEW.item_variant_id, 0, 0, 0)
  ON CONFLICT (store_id, item_variant_id) DO NOTHING;

  SELECT qty_on_hand, avg_unit_cost INTO v_current_qty, v_current_avg
    FROM stock_balances
    WHERE store_id = NEW.store_id AND item_variant_id = NEW.item_variant_id
    FOR UPDATE;

  IF NEW.qty < 0 THEN
    NEW.unit_cost := v_current_avg;
  ELSE
    NEW.unit_cost := COALESCE(NEW.unit_cost, v_current_avg);
    IF NEW.unit_cost = 0 AND v_current_avg > 0 THEN
      -- caller passed no hint (default 0) — fall back to current average
      NEW.unit_cost := v_current_avg;
    END IF;
  END IF;

  NEW.total_cost := ROUND(NEW.qty * NEW.unit_cost, 2);

  v_new_qty := v_current_qty + NEW.qty;
  IF NEW.qty > 0 AND v_new_qty <> 0 THEN
    v_new_avg := ROUND((v_current_qty * v_current_avg + NEW.qty * NEW.unit_cost) / v_new_qty, 4);
  ELSE
    v_new_avg := v_current_avg; -- outgoing movements never change the average
  END IF;

  UPDATE stock_balances
    SET qty_on_hand = v_new_qty,
        avg_unit_cost = v_new_avg,
        total_value = ROUND(v_new_qty * v_new_avg, 2),
        last_movement_at = NEW.movement_at
    WHERE store_id = NEW.store_id AND item_variant_id = NEW.item_variant_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_movements_process
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_process_stock_movement();

-- Full recompute from the ledger, ignoring the cache entirely — for
-- reconciliation, corruption recovery, or just proving the cache is
-- trustworthy. Never called automatically; an admin/ops operation.
CREATE OR REPLACE FUNCTION fn_rebuild_stock_balance(p_store_id UUID, p_item_variant_id UUID)
RETURNS VOID AS $$
DECLARE
  v_company_id UUID;
  v_qty NUMERIC(14,3) := 0;
  v_avg NUMERIC(14,4) := 0;
  v_new_qty NUMERIC(14,3);
  v_row RECORD;
BEGIN
  SELECT company_id INTO v_company_id FROM stores WHERE id = p_store_id;

  FOR v_row IN
    SELECT qty, unit_cost FROM stock_movements
    WHERE store_id = p_store_id AND item_variant_id = p_item_variant_id
    ORDER BY created_at
  LOOP
    v_new_qty := v_qty + v_row.qty;
    IF v_row.qty > 0 AND v_new_qty <> 0 THEN
      v_avg := ROUND((v_qty * v_avg + v_row.qty * v_row.unit_cost) / v_new_qty, 4);
    END IF;
    v_qty := v_new_qty;
  END LOOP;

  INSERT INTO stock_balances (company_id, store_id, item_variant_id, qty_on_hand, avg_unit_cost, total_value, last_movement_at)
  VALUES (v_company_id, p_store_id, p_item_variant_id, v_qty, v_avg, ROUND(v_qty * v_avg, 2), now())
  ON CONFLICT (store_id, item_variant_id) DO UPDATE
    SET qty_on_hand = EXCLUDED.qty_on_hand,
        avg_unit_cost = EXCLUDED.avg_unit_cost,
        total_value = EXCLUDED.total_value,
        last_movement_at = EXCLUDED.last_movement_at;
END;
$$ LANGUAGE plpgsql;
