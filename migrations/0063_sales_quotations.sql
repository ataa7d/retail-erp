-- Sales quotations: the sales-side counterpart to purchase requisitions,
-- but priced from the start (a customer needs to see a price to accept or
-- reject, unlike an internal requisition which only asks "do we need
-- these"). State machine:
--
--   draft --send--> sent --accept--> accepted --convert--> converted_to_invoice
--                        \-reject--> rejected
--                        \-withdraw--> withdrawn
--
-- rejected, withdrawn and converted_to_invoice are terminal. Unlike a
-- purchase requisition's approve step (an internal reviewer who must not be
-- the requester), accept/reject here records the CUSTOMER's decision --
-- there is no "cannot decide your own document" self-check, since the
-- salesperson who created the quotation is very often the same person who
-- relays the customer's verbal or written response.

CREATE TABLE sales_quotations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  store_id          UUID NOT NULL REFERENCES stores(id),
  customer_id       UUID NOT NULL REFERENCES customers(id),
  salesperson_id    UUID REFERENCES users(id),
  price_list_id     UUID REFERENCES price_lists(id),
  document_number   TEXT NOT NULL,
  quotation_date    DATE NOT NULL,
  valid_until       DATE,
  notes             TEXT,
  net_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  document_status   TEXT NOT NULL DEFAULT 'draft'
                       CHECK (document_status IN ('draft', 'sent', 'accepted', 'rejected', 'withdrawn', 'converted_to_invoice')),
  sent_at           TIMESTAMPTZ,
  decided_at        TIMESTAMPTZ,
  decided_by        UUID REFERENCES users(id),
  rejection_reason  TEXT,
  sales_invoice_id  UUID REFERENCES sales_invoices(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES users(id),
  UNIQUE (company_id, document_number),
  CHECK (fn_amounts_balance(net_amount, vat_amount, gross_amount))
);

CREATE INDEX idx_sales_quotations_company ON sales_quotations(company_id);
CREATE INDEX idx_sales_quotations_store ON sales_quotations(store_id);
CREATE INDEX idx_sales_quotations_customer ON sales_quotations(customer_id);
CREATE INDEX idx_sales_quotations_status ON sales_quotations(company_id, document_status);

CREATE TABLE sales_quotation_lines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id),
  quotation_id        UUID NOT NULL REFERENCES sales_quotations(id),
  line_number         INTEGER NOT NULL,
  item_variant_id     UUID NOT NULL REFERENCES item_variants(id),
  item_description    TEXT NOT NULL,
  qty                 NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  unit_price          NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  vat_rate            NUMERIC(5,2) NOT NULL CHECK (vat_rate >= 0),
  price_includes_vat  BOOLEAN NOT NULL,
  net_amount          NUMERIC(14,2) NOT NULL,
  vat_amount          NUMERIC(14,2) NOT NULL,
  gross_amount        NUMERIC(14,2) NOT NULL,
  UNIQUE (quotation_id, line_number),
  CHECK (fn_amounts_balance(net_amount, vat_amount, gross_amount))
);

CREATE INDEX idx_sales_quotation_lines_company ON sales_quotation_lines(company_id);
CREATE INDEX idx_sales_quotation_lines_quotation ON sales_quotation_lines(quotation_id);
CREATE INDEX idx_sales_quotation_lines_variant ON sales_quotation_lines(item_variant_id);

CREATE OR REPLACE FUNCTION check_sales_quotation_refs_company()
RETURNS TRIGGER AS $$
DECLARE
  ref_company_id UUID;
BEGIN
  SELECT company_id INTO ref_company_id FROM stores WHERE id = NEW.store_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'store % does not belong to company %', NEW.store_id, NEW.company_id;
  END IF;

  SELECT company_id INTO ref_company_id FROM customers WHERE id = NEW.customer_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'customer % does not belong to company %', NEW.customer_id, NEW.company_id;
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

CREATE TRIGGER trg_sales_quotations_check_refs
  BEFORE INSERT OR UPDATE ON sales_quotations
  FOR EACH ROW EXECUTE FUNCTION check_sales_quotation_refs_company();

CREATE OR REPLACE FUNCTION check_sales_quotation_line_variant()
RETURNS TRIGGER AS $$
DECLARE
  v_quotation_company_id UUID;
  v_variant_company_id UUID;
BEGIN
  SELECT company_id INTO v_quotation_company_id FROM sales_quotations WHERE id = NEW.quotation_id;
  IF NEW.company_id IS DISTINCT FROM v_quotation_company_id THEN
    RAISE EXCEPTION 'line company % does not match quotation % company', NEW.company_id, NEW.quotation_id;
  END IF;

  SELECT company_id INTO v_variant_company_id FROM item_variants WHERE id = NEW.item_variant_id;
  IF v_variant_company_id IS DISTINCT FROM v_quotation_company_id THEN
    RAISE EXCEPTION 'item_variant % does not belong to company %', NEW.item_variant_id, v_quotation_company_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_quotation_lines_check_variant
  BEFORE INSERT OR UPDATE ON sales_quotation_lines
  FOR EACH ROW EXECUTE FUNCTION check_sales_quotation_line_variant();

-- Lines are only editable while the header is still a draft -- once sent,
-- neither the salesperson nor anyone else can quietly change what the
-- customer is looking at.
CREATE OR REPLACE FUNCTION check_sales_quotation_line_immutable()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT document_status INTO v_status FROM sales_quotations
    WHERE id = COALESCE(NEW.quotation_id, OLD.quotation_id);
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'sales quotation % is % and its lines are immutable', COALESCE(NEW.quotation_id, OLD.quotation_id), v_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_quotation_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON sales_quotation_lines
  FOR EACH ROW EXECUTE FUNCTION check_sales_quotation_line_immutable();

-- Same structural guarantee as sales_invoices: header net/vat/gross are
-- always overwritten with a fresh SUM(lines), never trusted from the caller.
CREATE OR REPLACE FUNCTION recompute_sales_quotation_totals()
RETURNS TRIGGER AS $$
BEGIN
  SELECT COALESCE(SUM(net_amount), 0), COALESCE(SUM(vat_amount), 0), COALESCE(SUM(gross_amount), 0)
    INTO NEW.net_amount, NEW.vat_amount, NEW.gross_amount
    FROM sales_quotation_lines WHERE quotation_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_quotations_recompute_totals
  BEFORE INSERT OR UPDATE ON sales_quotations
  FOR EACH ROW EXECUTE FUNCTION recompute_sales_quotation_totals();

CREATE OR REPLACE FUNCTION touch_sales_quotation_header()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE sales_quotations SET id = id WHERE id = COALESCE(NEW.quotation_id, OLD.quotation_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_quotation_lines_touch_header
  AFTER INSERT OR UPDATE OR DELETE ON sales_quotation_lines
  FOR EACH ROW EXECUTE FUNCTION touch_sales_quotation_header();

CREATE OR REPLACE FUNCTION check_sales_quotation_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.document_status IN ('rejected', 'withdrawn', 'converted_to_invoice') THEN
    RAISE EXCEPTION 'sales quotation % is % and cannot be modified', OLD.id, OLD.document_status;
  END IF;

  IF NEW.document_status IS DISTINCT FROM OLD.document_status THEN
    IF OLD.document_status = 'draft' AND NEW.document_status = 'sent' THEN
      IF NOT EXISTS (SELECT 1 FROM sales_quotation_lines WHERE quotation_id = NEW.id) THEN
        RAISE EXCEPTION 'sales quotation % has no lines and cannot be sent', NEW.id;
      END IF;
      NEW.sent_at := now();

    ELSIF OLD.document_status = 'sent' AND NEW.document_status = 'accepted' THEN
      IF NEW.decided_by IS NULL THEN
        RAISE EXCEPTION 'sales quotation % cannot be accepted without decided_by', NEW.id;
      END IF;
      NEW.decided_at := now();

    ELSIF OLD.document_status = 'sent' AND NEW.document_status = 'rejected' THEN
      IF NEW.decided_by IS NULL THEN
        RAISE EXCEPTION 'sales quotation % cannot be rejected without decided_by', NEW.id;
      END IF;
      IF NEW.rejection_reason IS NULL OR btrim(NEW.rejection_reason) = '' THEN
        RAISE EXCEPTION 'sales quotation % cannot be rejected without a reason', NEW.id;
      END IF;
      NEW.decided_at := now();

    ELSIF OLD.document_status = 'sent' AND NEW.document_status = 'withdrawn' THEN
      NULL; -- the salesperson pulling their own quotation back; app layer checks who's calling

    ELSIF OLD.document_status = 'accepted' AND NEW.document_status = 'converted_to_invoice' THEN
      NULL; -- driven by the app once the invoice is created, no extra validation here

    ELSE
      RAISE EXCEPTION 'illegal sales quotation status transition from % to %', OLD.document_status, NEW.document_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_quotations_check_status_transition
  BEFORE UPDATE ON sales_quotations
  FOR EACH ROW EXECUTE FUNCTION check_sales_quotation_status_transition();

CREATE OR REPLACE FUNCTION check_sales_quotation_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN OLD;
  END IF;
  IF OLD.document_status <> 'draft' THEN
    RAISE EXCEPTION 'sales quotation % is % and cannot be deleted', OLD.id, OLD.document_status;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_quotations_check_delete
  BEFORE DELETE ON sales_quotations
  FOR EACH ROW EXECUTE FUNCTION check_sales_quotation_delete();

CREATE TRIGGER trg_sales_quotations_audit
  AFTER INSERT OR UPDATE OR DELETE ON sales_quotations
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_sales_quotation_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON sales_quotation_lines
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
