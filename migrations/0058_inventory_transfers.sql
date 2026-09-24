-- Multi-line inventory transfer document: move several items from one
-- store to another within the same company, with a draft/post lifecycle
-- (unlike the existing instant single-item POST /api/stock-transfers in
-- inventory.ts, which stays as a quick one-off action). Posting writes the
-- same transfer_out/transfer_in stock_movements pair per line that the
-- instant path already uses (see transferStock in inventoryService.ts),
-- so both mechanisms feed the same ledger and the same GET
-- /api/stock-transfers movement history. No GL journal: the goods keep
-- their exact cost across stores (see 0025's costing trigger), so a
-- transfer has zero P&L impact, unlike a stocktake variance.

CREATE TABLE inventory_transfers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id),
  source_store_id  UUID NOT NULL REFERENCES stores(id),
  dest_store_id    UUID NOT NULL REFERENCES stores(id),
  document_number  TEXT NOT NULL,
  transfer_date    DATE NOT NULL,
  fiscal_period_id UUID NOT NULL REFERENCES fiscal_periods(id),
  document_status  TEXT NOT NULL DEFAULT 'draft' CHECK (document_status IN ('draft', 'posted')),
  posted_at        TIMESTAMPTZ,
  posted_by        UUID REFERENCES users(id),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID REFERENCES users(id),
  UNIQUE (company_id, document_number),
  CHECK (source_store_id <> dest_store_id)
);

CREATE INDEX idx_inventory_transfers_company ON inventory_transfers(company_id);
CREATE INDEX idx_inventory_transfers_source_store ON inventory_transfers(source_store_id);
CREATE INDEX idx_inventory_transfers_dest_store ON inventory_transfers(dest_store_id);

CREATE TABLE inventory_transfer_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id),
  transfer_id     UUID NOT NULL REFERENCES inventory_transfers(id),
  item_variant_id UUID NOT NULL REFERENCES item_variants(id),
  qty             NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  UNIQUE (transfer_id, item_variant_id)
);

CREATE INDEX idx_inventory_transfer_lines_transfer ON inventory_transfer_lines(transfer_id);

CREATE OR REPLACE FUNCTION check_inventory_transfer_refs_company()
RETURNS TRIGGER AS $$
DECLARE
  ref_company_id UUID;
BEGIN
  SELECT company_id INTO ref_company_id FROM stores WHERE id = NEW.source_store_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'source store % does not belong to company %', NEW.source_store_id, NEW.company_id;
  END IF;

  SELECT company_id INTO ref_company_id FROM stores WHERE id = NEW.dest_store_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'destination store % does not belong to company %', NEW.dest_store_id, NEW.company_id;
  END IF;

  SELECT company_id INTO ref_company_id FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'fiscal period % does not belong to company %', NEW.fiscal_period_id, NEW.company_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_transfers_check_refs
  BEFORE INSERT OR UPDATE ON inventory_transfers
  FOR EACH ROW EXECUTE FUNCTION check_inventory_transfer_refs_company();

CREATE OR REPLACE FUNCTION check_inventory_transfer_line_company()
RETURNS TRIGGER AS $$
DECLARE
  v_transfer_company_id UUID;
  v_variant_company_id UUID;
BEGIN
  SELECT company_id INTO v_transfer_company_id FROM inventory_transfers WHERE id = NEW.transfer_id;
  IF NEW.company_id IS DISTINCT FROM v_transfer_company_id THEN
    RAISE EXCEPTION 'line company % does not match transfer % company', NEW.company_id, NEW.transfer_id;
  END IF;

  SELECT company_id INTO v_variant_company_id FROM item_variants WHERE id = NEW.item_variant_id;
  IF v_variant_company_id IS DISTINCT FROM v_transfer_company_id THEN
    RAISE EXCEPTION 'item_variant % does not belong to company %', NEW.item_variant_id, v_transfer_company_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_transfer_lines_check_company
  BEFORE INSERT OR UPDATE ON inventory_transfer_lines
  FOR EACH ROW EXECUTE FUNCTION check_inventory_transfer_line_company();

CREATE OR REPLACE FUNCTION check_inventory_transfer_line_immutable()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT document_status INTO v_status FROM inventory_transfers
    WHERE id = COALESCE(NEW.transfer_id, OLD.transfer_id);
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'inventory transfer % is posted; its lines are immutable', COALESCE(NEW.transfer_id, OLD.transfer_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_transfer_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON inventory_transfer_lines
  FOR EACH ROW EXECUTE FUNCTION check_inventory_transfer_line_immutable();

CREATE OR REPLACE FUNCTION check_inventory_transfer_posting()
RETURNS TRIGGER AS $$
DECLARE
  v_line_count INTEGER;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'inventory transfer % is posted and cannot be modified', OLD.id;
  END IF;

  IF NEW.document_status = 'posted' THEN
    SELECT COUNT(*) INTO v_line_count FROM inventory_transfer_lines WHERE transfer_id = NEW.id;
    IF v_line_count = 0 THEN
      RAISE EXCEPTION 'inventory transfer % has no lines and cannot be posted', NEW.id;
    END IF;

    NEW.posted_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_transfers_check_posting
  BEFORE UPDATE ON inventory_transfers
  FOR EACH ROW EXECUTE FUNCTION check_inventory_transfer_posting();

CREATE OR REPLACE FUNCTION check_inventory_transfer_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN OLD;
  END IF;
  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'inventory transfer % is posted and cannot be deleted', OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_transfers_check_delete
  BEFORE DELETE ON inventory_transfers
  FOR EACH ROW EXECUTE FUNCTION check_inventory_transfer_delete();

CREATE TRIGGER trg_inventory_transfers_audit
  AFTER INSERT OR UPDATE OR DELETE ON inventory_transfers
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_inventory_transfer_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON inventory_transfer_lines
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
