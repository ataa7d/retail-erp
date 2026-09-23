-- Stocktake: snapshot the system qty at count-start time, record what was
-- actually counted, and post the variance as stock_movements +
-- (Phase 5.5+) a GL entry. variance_qty is a generated column — a pure
-- per-row expression, safe to compute natively unlike the cross-row header
-- totals elsewhere in this schema.

CREATE TABLE stocktakes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id),
  store_id         UUID NOT NULL REFERENCES stores(id),
  document_number  TEXT NOT NULL,
  stocktake_date   DATE NOT NULL,
  fiscal_period_id UUID NOT NULL REFERENCES fiscal_periods(id),
  document_status  TEXT NOT NULL DEFAULT 'draft' CHECK (document_status IN ('draft', 'posted')),
  posted_at        TIMESTAMPTZ,
  posted_by        UUID REFERENCES users(id),
  journal_id       UUID REFERENCES journals(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID REFERENCES users(id),
  UNIQUE (company_id, document_number)
);

CREATE INDEX idx_stocktakes_company ON stocktakes(company_id);
CREATE INDEX idx_stocktakes_store ON stocktakes(store_id);

CREATE TABLE stocktake_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id),
  stocktake_id     UUID NOT NULL REFERENCES stocktakes(id),
  item_variant_id  UUID NOT NULL REFERENCES item_variants(id),
  snapshot_qty     NUMERIC(14,3) NOT NULL, -- stock_balances.qty_on_hand at the moment the count started
  counted_qty      NUMERIC(14,3),          -- NULL until actually counted
  variance_qty     NUMERIC(14,3) GENERATED ALWAYS AS (counted_qty - snapshot_qty) STORED,
  UNIQUE (stocktake_id, item_variant_id)
);

CREATE INDEX idx_stocktake_lines_stocktake ON stocktake_lines(stocktake_id);

CREATE OR REPLACE FUNCTION check_stocktake_refs_company()
RETURNS TRIGGER AS $$
DECLARE
  ref_company_id UUID;
BEGIN
  SELECT company_id INTO ref_company_id FROM stores WHERE id = NEW.store_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'store % does not belong to company %', NEW.store_id, NEW.company_id;
  END IF;

  SELECT company_id INTO ref_company_id FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'fiscal period % does not belong to company %', NEW.fiscal_period_id, NEW.company_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stocktakes_check_refs
  BEFORE INSERT OR UPDATE ON stocktakes
  FOR EACH ROW EXECUTE FUNCTION check_stocktake_refs_company();

CREATE OR REPLACE FUNCTION check_stocktake_line_company()
RETURNS TRIGGER AS $$
DECLARE
  v_stocktake_company_id UUID;
  v_variant_company_id UUID;
BEGIN
  SELECT company_id INTO v_stocktake_company_id FROM stocktakes WHERE id = NEW.stocktake_id;
  IF NEW.company_id IS DISTINCT FROM v_stocktake_company_id THEN
    RAISE EXCEPTION 'line company % does not match stocktake % company', NEW.company_id, NEW.stocktake_id;
  END IF;

  SELECT company_id INTO v_variant_company_id FROM item_variants WHERE id = NEW.item_variant_id;
  IF v_variant_company_id IS DISTINCT FROM v_stocktake_company_id THEN
    RAISE EXCEPTION 'item_variant % does not belong to company %', NEW.item_variant_id, v_stocktake_company_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stocktake_lines_check_company
  BEFORE INSERT OR UPDATE ON stocktake_lines
  FOR EACH ROW EXECUTE FUNCTION check_stocktake_line_company();

CREATE OR REPLACE FUNCTION check_stocktake_line_immutable()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT document_status INTO v_status FROM stocktakes
    WHERE id = COALESCE(NEW.stocktake_id, OLD.stocktake_id);
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'stocktake % is posted; its lines are immutable', COALESCE(NEW.stocktake_id, OLD.stocktake_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stocktake_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON stocktake_lines
  FOR EACH ROW EXECUTE FUNCTION check_stocktake_line_immutable();

CREATE OR REPLACE FUNCTION check_stocktake_posting()
RETURNS TRIGGER AS $$
DECLARE
  v_journal_status TEXT;
  v_uncounted_count INTEGER;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'stocktake % is posted and cannot be modified', OLD.id;
  END IF;

  IF NEW.document_status = 'posted' THEN
    SELECT COUNT(*) INTO v_uncounted_count FROM stocktake_lines
      WHERE stocktake_id = NEW.id AND counted_qty IS NULL;
    IF v_uncounted_count > 0 THEN
      RAISE EXCEPTION 'stocktake % has % uncounted line(s)', NEW.id, v_uncounted_count;
    END IF;

    -- A stocktake with no variance at all is valid but has no journal
    -- (nothing to post); one with variance must have a posted journal,
    -- same pattern as sales_invoices/credit_notes.
    IF EXISTS (SELECT 1 FROM stocktake_lines WHERE stocktake_id = NEW.id AND variance_qty <> 0)
       AND NEW.journal_id IS NULL THEN
      RAISE EXCEPTION 'stocktake % has variance and cannot be posted without a GL journal', NEW.id;
    END IF;

    IF NEW.journal_id IS NOT NULL THEN
      SELECT document_status INTO v_journal_status FROM journals WHERE id = NEW.journal_id;
      IF v_journal_status IS DISTINCT FROM 'posted' THEN
        RAISE EXCEPTION 'stocktake % journal % must be posted first', NEW.id, NEW.journal_id;
      END IF;
    END IF;

    NEW.posted_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stocktakes_check_posting
  BEFORE UPDATE ON stocktakes
  FOR EACH ROW EXECUTE FUNCTION check_stocktake_posting();

CREATE TRIGGER trg_stocktakes_audit
  AFTER INSERT OR UPDATE OR DELETE ON stocktakes
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_stocktake_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON stocktake_lines
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
