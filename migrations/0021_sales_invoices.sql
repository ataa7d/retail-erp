-- sales_invoices covers both POS and wholesale sales in one table
-- (invoice_channel distinguishes them) because the money and posting rules
-- are identical for both — two separate table sets would just be the same
-- logic duplicated twice, with the two copies free to drift apart.
--
-- zatca_invoice_category is stored explicitly rather than derived from
-- channel: a POS sale to a VAT-registered business that requests a formal
-- tax invoice is still 'standard', not 'simplified', even though it came
-- through the POS channel. This distinction is what Phase 8's offline
-- design hinges on: simplified invoices can be issued offline and reported
-- within 24h; standard invoices must be cleared before the customer gets
-- them, so the POS must refuse to issue one offline.

CREATE TYPE invoice_channel_type AS ENUM ('pos', 'wholesale');
CREATE TYPE zatca_invoice_category AS ENUM ('simplified', 'standard');
CREATE TYPE sales_line_type AS ENUM ('item', 'charge');

CREATE TABLE sales_invoices (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES companies(id),
  store_id                UUID NOT NULL REFERENCES stores(id),
  invoice_channel         invoice_channel_type NOT NULL,
  zatca_invoice_category  zatca_invoice_category NOT NULL,
  document_number         TEXT NOT NULL,
  invoice_date            DATE NOT NULL,
  fiscal_period_id        UUID NOT NULL REFERENCES fiscal_periods(id),
  customer_id             UUID REFERENCES customers(id),
  salesperson_id          UUID REFERENCES users(id),
  price_list_id           UUID REFERENCES price_lists(id),
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

CREATE INDEX idx_sales_invoices_company ON sales_invoices(company_id);
CREATE INDEX idx_sales_invoices_store ON sales_invoices(store_id);
CREATE INDEX idx_sales_invoices_customer ON sales_invoices(customer_id);
CREATE INDEX idx_sales_invoices_fiscal_period ON sales_invoices(fiscal_period_id);

CREATE TABLE sales_invoice_lines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id),
  invoice_id          UUID NOT NULL REFERENCES sales_invoices(id),
  line_number         INTEGER NOT NULL,
  line_type           sales_line_type NOT NULL DEFAULT 'item',
  item_variant_id     UUID REFERENCES item_variants(id),
  item_description    TEXT NOT NULL, -- snapshot of the item name at sale time, independent of later renames
  qty                 NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  unit_price          NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  vat_rate            NUMERIC(5,2) NOT NULL CHECK (vat_rate >= 0),
  price_includes_vat  BOOLEAN NOT NULL,
  net_amount          NUMERIC(14,2) NOT NULL,
  vat_amount          NUMERIC(14,2) NOT NULL,
  gross_amount        NUMERIC(14,2) NOT NULL,
  UNIQUE (invoice_id, line_number),
  CHECK (fn_amounts_balance(net_amount, vat_amount, gross_amount)),
  -- charge lines (delivery, freight, header discount) carry no item — see rule B
  CHECK ((line_type = 'item' AND item_variant_id IS NOT NULL) OR (line_type = 'charge' AND item_variant_id IS NULL))
);

CREATE INDEX idx_sales_invoice_lines_company ON sales_invoice_lines(company_id);
CREATE INDEX idx_sales_invoice_lines_invoice ON sales_invoice_lines(invoice_id);
CREATE INDEX idx_sales_invoice_lines_variant ON sales_invoice_lines(item_variant_id);

-- Cross-company checks: store/customer/salesperson/price_list/fiscal_period
-- referenced by the header must all belong to the invoice's own company.
CREATE OR REPLACE FUNCTION check_sales_invoice_refs_company()
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

  IF NEW.customer_id IS NOT NULL THEN
    SELECT company_id INTO ref_company_id FROM customers WHERE id = NEW.customer_id;
    IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'customer % does not belong to company %', NEW.customer_id, NEW.company_id;
    END IF;
  END IF;

  IF NEW.price_list_id IS NOT NULL THEN
    SELECT company_id INTO ref_company_id FROM price_lists WHERE id = NEW.price_list_id;
    IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'price list % does not belong to company %', NEW.price_list_id, NEW.company_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_invoices_check_refs
  BEFORE INSERT OR UPDATE ON sales_invoices
  FOR EACH ROW EXECUTE FUNCTION check_sales_invoice_refs_company();

CREATE OR REPLACE FUNCTION check_sales_invoice_line_variant()
RETURNS TRIGGER AS $$
DECLARE
  v_invoice_company_id UUID;
  v_variant_company_id UUID;
BEGIN
  SELECT company_id INTO v_invoice_company_id FROM sales_invoices WHERE id = NEW.invoice_id;
  IF NEW.company_id IS DISTINCT FROM v_invoice_company_id THEN
    RAISE EXCEPTION 'line company % does not match invoice % company', NEW.company_id, NEW.invoice_id;
  END IF;

  IF NEW.item_variant_id IS NOT NULL THEN
    SELECT company_id INTO v_variant_company_id FROM item_variants WHERE id = NEW.item_variant_id;
    IF v_variant_company_id IS DISTINCT FROM v_invoice_company_id THEN
      RAISE EXCEPTION 'item_variant % does not belong to company %', NEW.item_variant_id, v_invoice_company_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_invoice_lines_check_variant
  BEFORE INSERT OR UPDATE ON sales_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION check_sales_invoice_line_variant();

-- Lines are only editable while the parent invoice is 'draft' (same pattern
-- as journal_lines in Phase 3).
CREATE OR REPLACE FUNCTION check_sales_invoice_line_immutable()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT document_status INTO v_status FROM sales_invoices
    WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'invoice % is posted; its lines are immutable', COALESCE(NEW.invoice_id, OLD.invoice_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_invoice_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON sales_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION check_sales_invoice_line_immutable();

-- rule C, made structurally impossible to violate rather than merely
-- checked: the header's net/vat/gross are always overwritten with a fresh
-- SUM(lines) on every header INSERT/UPDATE, regardless of what the caller
-- passed in. Combined with the AAI trigger below (which touches the header
-- whenever a line changes), this is both "recomputed on every save" and
-- the "permanent consistency check" in one mechanism — there is no code
-- path that can leave header != SUM(lines).
CREATE OR REPLACE FUNCTION recompute_sales_invoice_totals()
RETURNS TRIGGER AS $$
BEGIN
  SELECT COALESCE(SUM(net_amount), 0), COALESCE(SUM(vat_amount), 0), COALESCE(SUM(gross_amount), 0)
    INTO NEW.net_amount, NEW.vat_amount, NEW.gross_amount
    FROM sales_invoice_lines WHERE invoice_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_invoices_recompute_totals
  BEFORE INSERT OR UPDATE ON sales_invoices
  FOR EACH ROW EXECUTE FUNCTION recompute_sales_invoice_totals();

CREATE OR REPLACE FUNCTION touch_sales_invoice_header()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE sales_invoices SET id = id WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_invoice_lines_touch_header
  AFTER INSERT OR UPDATE OR DELETE ON sales_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION touch_sales_invoice_header();

-- Posting: mirrors journals' check_journal_posting (Phase 3) — the
-- invariant lives on the table via trigger, not a skippable function.
-- Posting a sales invoice requires its GL journal to already be posted
-- (same transaction, journal posted first, then this) and, for POS sales,
-- the payment breakdown to fully cover the invoice total.
CREATE OR REPLACE FUNCTION check_sales_invoice_posting()
RETURNS TRIGGER AS $$
DECLARE
  v_journal_status TEXT;
  v_payments_total NUMERIC(14,2);
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'invoice % is posted and cannot be modified', OLD.id;
  END IF;

  IF NEW.document_status = 'posted' THEN
    IF NEW.journal_id IS NULL THEN
      RAISE EXCEPTION 'invoice % cannot be posted without a GL journal', NEW.id;
    END IF;

    SELECT document_status INTO v_journal_status FROM journals WHERE id = NEW.journal_id;
    IF v_journal_status IS DISTINCT FROM 'posted' THEN
      RAISE EXCEPTION 'invoice % journal % must be posted first', NEW.id, NEW.journal_id;
    END IF;

    IF NEW.invoice_channel = 'pos' THEN
      SELECT COALESCE(SUM(amount), 0) INTO v_payments_total
        FROM sales_invoice_payments WHERE invoice_id = NEW.id;
      IF v_payments_total <> NEW.gross_amount THEN
        RAISE EXCEPTION 'invoice % payments (%) do not cover the total (%)', NEW.id, v_payments_total, NEW.gross_amount;
      END IF;
    END IF;

    NEW.posted_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_invoices_check_posting
  BEFORE UPDATE ON sales_invoices
  FOR EACH ROW EXECUTE FUNCTION check_sales_invoice_posting();

CREATE OR REPLACE FUNCTION check_sales_invoice_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN OLD;
  END IF;
  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'invoice % is posted and cannot be deleted', OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_invoices_check_delete
  BEFORE DELETE ON sales_invoices
  FOR EACH ROW EXECUTE FUNCTION check_sales_invoice_delete();

CREATE TRIGGER trg_sales_invoices_audit
  AFTER INSERT OR UPDATE OR DELETE ON sales_invoices
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_sales_invoice_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON sales_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
