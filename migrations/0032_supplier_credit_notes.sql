-- Widen the sign-check to cover purchase_return (outgoing, qty < 0) now
-- that the enum value exists (0031 committed it in a prior transaction).
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_check1;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_check1 CHECK (
  (movement_type IN ('receipt', 'transfer_in', 'adjustment_in', 'sales_return') AND qty > 0) OR
  (movement_type IN ('issue', 'transfer_out', 'adjustment_out', 'purchase_return') AND qty < 0) OR
  (movement_type = 'stocktake_variance')
);

-- supplier_credit_notes: modeled as post-invoice (the common real-world
-- case — a defect or shortage found after the supplier invoice already
-- posted). Reverses AP, inventory, and the input VAT claim. A pre-invoice
-- return against GRNI is a different flow this phase doesn't build.

CREATE TABLE supplier_credit_notes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id),
  store_id            UUID NOT NULL REFERENCES stores(id),
  supplier_id         UUID NOT NULL REFERENCES suppliers(id),
  original_invoice_id UUID NOT NULL REFERENCES supplier_invoices(id),
  document_number     TEXT NOT NULL,
  credit_note_date    DATE NOT NULL,
  fiscal_period_id    UUID NOT NULL REFERENCES fiscal_periods(id),
  reason              TEXT NOT NULL,
  net_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  document_status     TEXT NOT NULL DEFAULT 'draft' CHECK (document_status IN ('draft', 'posted')),
  posted_at           TIMESTAMPTZ,
  posted_by           UUID REFERENCES users(id),
  journal_id          UUID REFERENCES journals(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID REFERENCES users(id),
  UNIQUE (company_id, document_number),
  CHECK (fn_amounts_balance(net_amount, vat_amount, gross_amount))
);

CREATE INDEX idx_supplier_credit_notes_company ON supplier_credit_notes(company_id);
CREATE INDEX idx_supplier_credit_notes_invoice ON supplier_credit_notes(original_invoice_id);

CREATE TABLE supplier_credit_note_lines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES companies(id),
  supplier_credit_note_id UUID NOT NULL REFERENCES supplier_credit_notes(id),
  line_number           INTEGER NOT NULL,
  source_line_id        UUID NOT NULL REFERENCES supplier_invoice_lines(id),
  item_variant_id       UUID NOT NULL REFERENCES item_variants(id),
  qty                   NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  unit_price             NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  vat_rate              NUMERIC(5,2) NOT NULL CHECK (vat_rate >= 0),
  price_includes_vat    BOOLEAN NOT NULL DEFAULT false,
  net_amount            NUMERIC(14,2) NOT NULL,
  vat_amount            NUMERIC(14,2) NOT NULL,
  gross_amount          NUMERIC(14,2) NOT NULL,
  UNIQUE (supplier_credit_note_id, line_number),
  CHECK (fn_amounts_balance(net_amount, vat_amount, gross_amount))
);

CREATE INDEX idx_supplier_credit_note_lines_company ON supplier_credit_note_lines(company_id);
CREATE INDEX idx_supplier_credit_note_lines_note ON supplier_credit_note_lines(supplier_credit_note_id);
CREATE INDEX idx_supplier_credit_note_lines_source ON supplier_credit_note_lines(source_line_id);

CREATE OR REPLACE FUNCTION check_supplier_credit_note_refs_company()
RETURNS TRIGGER AS $$
DECLARE
  ref_company_id UUID;
BEGIN
  SELECT company_id INTO ref_company_id FROM stores WHERE id = NEW.store_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'store % does not belong to company %', NEW.store_id, NEW.company_id;
  END IF;

  SELECT company_id INTO ref_company_id FROM supplier_invoices WHERE id = NEW.original_invoice_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'original invoice % does not belong to company %', NEW.original_invoice_id, NEW.company_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_credit_notes_check_refs
  BEFORE INSERT OR UPDATE ON supplier_credit_notes
  FOR EACH ROW EXECUTE FUNCTION check_supplier_credit_note_refs_company();

CREATE OR REPLACE FUNCTION check_supplier_credit_note_line_source()
RETURNS TRIGGER AS $$
DECLARE
  v_note_company_id UUID;
  v_note_invoice_id UUID;
  v_source_invoice_id UUID;
  v_source_variant_id UUID;
BEGIN
  SELECT company_id, original_invoice_id INTO v_note_company_id, v_note_invoice_id
    FROM supplier_credit_notes WHERE id = NEW.supplier_credit_note_id;

  IF NEW.company_id IS DISTINCT FROM v_note_company_id THEN
    RAISE EXCEPTION 'line company % does not match credit note % company', NEW.company_id, NEW.supplier_credit_note_id;
  END IF;

  SELECT supplier_invoice_id, item_variant_id INTO v_source_invoice_id, v_source_variant_id
    FROM supplier_invoice_lines WHERE id = NEW.source_line_id;

  IF v_source_invoice_id IS DISTINCT FROM v_note_invoice_id THEN
    RAISE EXCEPTION 'source line % does not belong to credit note %''s original invoice', NEW.source_line_id, NEW.supplier_credit_note_id;
  END IF;

  IF NEW.item_variant_id IS DISTINCT FROM v_source_variant_id THEN
    RAISE EXCEPTION 'credit note line item_variant % does not match source line item_variant %', NEW.item_variant_id, v_source_variant_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_credit_note_lines_check_source
  BEFORE INSERT OR UPDATE ON supplier_credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION check_supplier_credit_note_line_source();

CREATE OR REPLACE FUNCTION check_supplier_credit_note_line_immutable()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT document_status INTO v_status FROM supplier_credit_notes
    WHERE id = COALESCE(NEW.supplier_credit_note_id, OLD.supplier_credit_note_id);
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'supplier credit note % is posted; its lines are immutable', COALESCE(NEW.supplier_credit_note_id, OLD.supplier_credit_note_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_credit_note_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON supplier_credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION check_supplier_credit_note_line_immutable();

CREATE OR REPLACE FUNCTION recompute_supplier_credit_note_totals()
RETURNS TRIGGER AS $$
BEGIN
  SELECT COALESCE(SUM(net_amount), 0), COALESCE(SUM(vat_amount), 0), COALESCE(SUM(gross_amount), 0)
    INTO NEW.net_amount, NEW.vat_amount, NEW.gross_amount
    FROM supplier_credit_note_lines WHERE supplier_credit_note_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_credit_notes_recompute_totals
  BEFORE INSERT OR UPDATE ON supplier_credit_notes
  FOR EACH ROW EXECUTE FUNCTION recompute_supplier_credit_note_totals();

CREATE OR REPLACE FUNCTION touch_supplier_credit_note_header()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE supplier_credit_notes SET id = id WHERE id = COALESCE(NEW.supplier_credit_note_id, OLD.supplier_credit_note_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_credit_note_lines_touch_header
  AFTER INSERT OR UPDATE OR DELETE ON supplier_credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION touch_supplier_credit_note_header();

CREATE OR REPLACE FUNCTION check_supplier_credit_note_posting()
RETURNS TRIGGER AS $$
DECLARE
  v_journal_status TEXT;
  v_line RECORD;
  v_invoiced_qty NUMERIC(14,3);
  v_already_returned_qty NUMERIC(14,3);
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'supplier credit note % is posted and cannot be modified', OLD.id;
  END IF;

  IF NEW.document_status = 'posted' THEN
    IF NEW.journal_id IS NULL THEN
      RAISE EXCEPTION 'supplier credit note % cannot be posted without a GL journal', NEW.id;
    END IF;
    SELECT document_status INTO v_journal_status FROM journals WHERE id = NEW.journal_id;
    IF v_journal_status IS DISTINCT FROM 'posted' THEN
      RAISE EXCEPTION 'supplier credit note % journal % must be posted first', NEW.id, NEW.journal_id;
    END IF;

    FOR v_line IN SELECT source_line_id, qty FROM supplier_credit_note_lines WHERE supplier_credit_note_id = NEW.id LOOP
      SELECT qty INTO v_invoiced_qty FROM supplier_invoice_lines WHERE id = v_line.source_line_id;

      SELECT COALESCE(SUM(scnl.qty), 0) INTO v_already_returned_qty
        FROM supplier_credit_note_lines scnl
        JOIN supplier_credit_notes scn ON scn.id = scnl.supplier_credit_note_id
        WHERE scnl.source_line_id = v_line.source_line_id
          AND scn.document_status = 'posted'
          AND scn.id <> NEW.id;

      IF v_already_returned_qty + v_line.qty > v_invoiced_qty THEN
        RAISE EXCEPTION 'source line % : returning % would exceed invoiced quantity (% already returned of %)',
          v_line.source_line_id, v_line.qty, v_already_returned_qty, v_invoiced_qty;
      END IF;
    END LOOP;

    NEW.posted_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_credit_notes_check_posting
  BEFORE UPDATE ON supplier_credit_notes
  FOR EACH ROW EXECUTE FUNCTION check_supplier_credit_note_posting();

CREATE TRIGGER trg_supplier_credit_notes_audit
  AFTER INSERT OR UPDATE OR DELETE ON supplier_credit_notes
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_supplier_credit_note_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON supplier_credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
