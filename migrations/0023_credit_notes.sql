-- credit_notes is Phase 4's sales-return / credit-note document: always
-- tied to an original sales_invoices, always recalculates its own
-- net/vat/gross fresh from its own qty and price (never copies or scales
-- the original line's amounts — see rule under Sales/Returns), and can
-- never return more than was sold. The physical goods-back-into-stock
-- movement is wired in when Phase 5's stock ledger exists; this table
-- only carries the financial/tax side for now.

CREATE TABLE credit_notes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES companies(id),
  store_id                UUID NOT NULL REFERENCES stores(id),
  original_invoice_id     UUID NOT NULL REFERENCES sales_invoices(id),
  zatca_invoice_category  zatca_invoice_category NOT NULL,
  document_number         TEXT NOT NULL,
  credit_note_date        DATE NOT NULL,
  fiscal_period_id        UUID NOT NULL REFERENCES fiscal_periods(id),
  customer_id             UUID REFERENCES customers(id),
  reason                  TEXT NOT NULL,
  net_amount              NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_amount              NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  document_status         TEXT NOT NULL DEFAULT 'draft' CHECK (document_status IN ('draft', 'posted')),
  posted_at               TIMESTAMPTZ,
  posted_by               UUID REFERENCES users(id),
  journal_id              UUID REFERENCES journals(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              UUID REFERENCES users(id),
  UNIQUE (company_id, document_number),
  CHECK (fn_amounts_balance(net_amount, vat_amount, gross_amount))
);

CREATE INDEX idx_credit_notes_company ON credit_notes(company_id);
CREATE INDEX idx_credit_notes_original_invoice ON credit_notes(original_invoice_id);
CREATE INDEX idx_credit_notes_fiscal_period ON credit_notes(fiscal_period_id);

CREATE TABLE credit_note_lines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id),
  credit_note_id      UUID NOT NULL REFERENCES credit_notes(id),
  line_number         INTEGER NOT NULL,
  source_line_id      UUID NOT NULL REFERENCES sales_invoice_lines(id),
  item_variant_id     UUID REFERENCES item_variants(id),
  item_description    TEXT NOT NULL,
  qty                 NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  unit_price          NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  vat_rate            NUMERIC(5,2) NOT NULL CHECK (vat_rate >= 0),
  price_includes_vat  BOOLEAN NOT NULL,
  net_amount          NUMERIC(14,2) NOT NULL,
  vat_amount          NUMERIC(14,2) NOT NULL,
  gross_amount        NUMERIC(14,2) NOT NULL,
  UNIQUE (credit_note_id, line_number),
  CHECK (fn_amounts_balance(net_amount, vat_amount, gross_amount))
);

CREATE INDEX idx_credit_note_lines_company ON credit_note_lines(company_id);
CREATE INDEX idx_credit_note_lines_credit_note ON credit_note_lines(credit_note_id);
CREATE INDEX idx_credit_note_lines_source_line ON credit_note_lines(source_line_id);

CREATE OR REPLACE FUNCTION check_credit_note_refs_company()
RETURNS TRIGGER AS $$
DECLARE
  ref_company_id UUID;
BEGIN
  SELECT company_id INTO ref_company_id FROM stores WHERE id = NEW.store_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'store % does not belong to company %', NEW.store_id, NEW.company_id;
  END IF;

  SELECT company_id INTO ref_company_id FROM sales_invoices WHERE id = NEW.original_invoice_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'original invoice % does not belong to company %', NEW.original_invoice_id, NEW.company_id;
  END IF;

  SELECT company_id INTO ref_company_id FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'fiscal period % does not belong to company %', NEW.fiscal_period_id, NEW.company_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_credit_notes_check_refs
  BEFORE INSERT OR UPDATE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION check_credit_note_refs_company();

-- source_line_id must belong to this credit note's own original_invoice_id
-- (can't return a line from a different sale than the one this credit note
-- is against), and item_variant_id/vat_rate/price_includes_vat must match
-- what was actually sold on that line.
CREATE OR REPLACE FUNCTION check_credit_note_line_source()
RETURNS TRIGGER AS $$
DECLARE
  v_credit_note_company_id UUID;
  v_credit_note_invoice_id UUID;
  v_source_invoice_id UUID;
  v_source_variant_id UUID;
  v_source_vat_rate NUMERIC(5,2);
  v_source_price_includes_vat BOOLEAN;
BEGIN
  SELECT company_id, original_invoice_id INTO v_credit_note_company_id, v_credit_note_invoice_id
    FROM credit_notes WHERE id = NEW.credit_note_id;

  IF NEW.company_id IS DISTINCT FROM v_credit_note_company_id THEN
    RAISE EXCEPTION 'line company % does not match credit note % company', NEW.company_id, NEW.credit_note_id;
  END IF;

  SELECT invoice_id, item_variant_id, vat_rate, price_includes_vat
    INTO v_source_invoice_id, v_source_variant_id, v_source_vat_rate, v_source_price_includes_vat
    FROM sales_invoice_lines WHERE id = NEW.source_line_id;

  IF v_source_invoice_id IS DISTINCT FROM v_credit_note_invoice_id THEN
    RAISE EXCEPTION 'source line % does not belong to credit note %''s original invoice', NEW.source_line_id, NEW.credit_note_id;
  END IF;

  IF NEW.item_variant_id IS DISTINCT FROM v_source_variant_id THEN
    RAISE EXCEPTION 'credit note line item_variant % does not match source line item_variant %', NEW.item_variant_id, v_source_variant_id;
  END IF;

  IF NEW.vat_rate IS DISTINCT FROM v_source_vat_rate THEN
    RAISE EXCEPTION 'credit note line vat_rate % does not match source line vat_rate %', NEW.vat_rate, v_source_vat_rate;
  END IF;

  IF NEW.price_includes_vat IS DISTINCT FROM v_source_price_includes_vat THEN
    RAISE EXCEPTION 'credit note line price_includes_vat does not match source line';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_credit_note_lines_check_source
  BEFORE INSERT OR UPDATE ON credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION check_credit_note_line_source();

CREATE OR REPLACE FUNCTION check_credit_note_line_immutable()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT document_status INTO v_status FROM credit_notes
    WHERE id = COALESCE(NEW.credit_note_id, OLD.credit_note_id);
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'credit note % is posted; its lines are immutable', COALESCE(NEW.credit_note_id, OLD.credit_note_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_credit_note_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION check_credit_note_line_immutable();

CREATE OR REPLACE FUNCTION recompute_credit_note_totals()
RETURNS TRIGGER AS $$
BEGIN
  SELECT COALESCE(SUM(net_amount), 0), COALESCE(SUM(vat_amount), 0), COALESCE(SUM(gross_amount), 0)
    INTO NEW.net_amount, NEW.vat_amount, NEW.gross_amount
    FROM credit_note_lines WHERE credit_note_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_credit_notes_recompute_totals
  BEFORE INSERT OR UPDATE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION recompute_credit_note_totals();

CREATE OR REPLACE FUNCTION touch_credit_note_header()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE credit_notes SET id = id WHERE id = COALESCE(NEW.credit_note_id, OLD.credit_note_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_credit_note_lines_touch_header
  AFTER INSERT OR UPDATE OR DELETE ON credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION touch_credit_note_header();

-- Posting: same pattern as sales_invoices, plus the authoritative
-- "cannot exceed quantity sold" check — done here, at posting time, not at
-- line-insert time, so two concurrently-drafted credit notes against the
-- same source line can both be edited freely and only the second one to
-- actually post gets rejected (mirrors how journal balance is only ever
-- checked at the posting transition, not at every line insert).
CREATE OR REPLACE FUNCTION check_credit_note_posting()
RETURNS TRIGGER AS $$
DECLARE
  v_journal_status TEXT;
  v_line RECORD;
  v_sold_qty NUMERIC(14,3);
  v_already_returned_qty NUMERIC(14,3);
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'credit note % is posted and cannot be modified', OLD.id;
  END IF;

  IF NEW.document_status = 'posted' THEN
    IF NEW.journal_id IS NULL THEN
      RAISE EXCEPTION 'credit note % cannot be posted without a GL journal', NEW.id;
    END IF;

    SELECT document_status INTO v_journal_status FROM journals WHERE id = NEW.journal_id;
    IF v_journal_status IS DISTINCT FROM 'posted' THEN
      RAISE EXCEPTION 'credit note % journal % must be posted first', NEW.id, NEW.journal_id;
    END IF;

    FOR v_line IN SELECT source_line_id, qty FROM credit_note_lines WHERE credit_note_id = NEW.id LOOP
      SELECT qty INTO v_sold_qty FROM sales_invoice_lines WHERE id = v_line.source_line_id;

      SELECT COALESCE(SUM(cnl.qty), 0) INTO v_already_returned_qty
        FROM credit_note_lines cnl
        JOIN credit_notes cn ON cn.id = cnl.credit_note_id
        WHERE cnl.source_line_id = v_line.source_line_id
          AND cn.document_status = 'posted'
          AND cn.id <> NEW.id;

      IF v_already_returned_qty + v_line.qty > v_sold_qty THEN
        RAISE EXCEPTION 'source line % : returning % would exceed quantity sold (% already returned of %)',
          v_line.source_line_id, v_line.qty, v_already_returned_qty, v_sold_qty;
      END IF;
    END LOOP;

    NEW.posted_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_credit_notes_check_posting
  BEFORE UPDATE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION check_credit_note_posting();

CREATE OR REPLACE FUNCTION check_credit_note_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN OLD;
  END IF;
  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'credit note % is posted and cannot be deleted', OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_credit_notes_check_delete
  BEFORE DELETE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION check_credit_note_delete();

CREATE TRIGGER trg_credit_notes_audit
  AFTER INSERT OR UPDATE OR DELETE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_credit_note_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
