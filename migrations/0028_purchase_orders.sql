-- Purchase orders are commitments, not recognized financial transactions —
-- they never post a GL journal. 'posted' here means "approved and locked,"
-- the point after which goods receipts can be entered against it.
-- received_qty is maintained by a trigger fired when a goods receipt posts
-- (0029), recomputed from scratch each time, never incremented in place.

CREATE TABLE purchase_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  store_id          UUID NOT NULL REFERENCES stores(id),
  supplier_id       UUID NOT NULL REFERENCES suppliers(id),
  document_number   TEXT NOT NULL,
  order_date        DATE NOT NULL,
  expected_date     DATE,
  fiscal_period_id  UUID NOT NULL REFERENCES fiscal_periods(id),
  net_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  document_status   TEXT NOT NULL DEFAULT 'draft' CHECK (document_status IN ('draft', 'posted')),
  posted_at         TIMESTAMPTZ,
  posted_by         UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES users(id),
  UNIQUE (company_id, document_number),
  CHECK (fn_amounts_balance(net_amount, vat_amount, gross_amount))
);

CREATE INDEX idx_purchase_orders_company ON purchase_orders(company_id);
CREATE INDEX idx_purchase_orders_supplier ON purchase_orders(supplier_id);

CREATE TABLE purchase_order_lines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id),
  purchase_order_id   UUID NOT NULL REFERENCES purchase_orders(id),
  line_number         INTEGER NOT NULL,
  item_variant_id     UUID NOT NULL REFERENCES item_variants(id),
  qty                 NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  unit_price          NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  vat_rate            NUMERIC(5,2) NOT NULL CHECK (vat_rate >= 0),
  price_includes_vat  BOOLEAN NOT NULL DEFAULT false,
  net_amount          NUMERIC(14,2) NOT NULL,
  vat_amount          NUMERIC(14,2) NOT NULL,
  gross_amount        NUMERIC(14,2) NOT NULL,
  received_qty        NUMERIC(14,3) NOT NULL DEFAULT 0,
  UNIQUE (purchase_order_id, line_number),
  CHECK (fn_amounts_balance(net_amount, vat_amount, gross_amount))
);

CREATE INDEX idx_purchase_order_lines_company ON purchase_order_lines(company_id);
CREATE INDEX idx_purchase_order_lines_po ON purchase_order_lines(purchase_order_id);

CREATE OR REPLACE FUNCTION check_purchase_order_refs_company()
RETURNS TRIGGER AS $$
DECLARE
  ref_company_id UUID;
BEGIN
  SELECT company_id INTO ref_company_id FROM stores WHERE id = NEW.store_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'store % does not belong to company %', NEW.store_id, NEW.company_id;
  END IF;

  SELECT company_id INTO ref_company_id FROM suppliers WHERE id = NEW.supplier_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'supplier % does not belong to company %', NEW.supplier_id, NEW.company_id;
  END IF;

  SELECT company_id INTO ref_company_id FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'fiscal period % does not belong to company %', NEW.fiscal_period_id, NEW.company_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_purchase_orders_check_refs
  BEFORE INSERT OR UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION check_purchase_order_refs_company();

CREATE OR REPLACE FUNCTION check_purchase_order_line_variant()
RETURNS TRIGGER AS $$
DECLARE
  v_po_company_id UUID;
  v_variant_company_id UUID;
BEGIN
  SELECT company_id INTO v_po_company_id FROM purchase_orders WHERE id = NEW.purchase_order_id;
  IF NEW.company_id IS DISTINCT FROM v_po_company_id THEN
    RAISE EXCEPTION 'line company % does not match purchase order % company', NEW.company_id, NEW.purchase_order_id;
  END IF;

  SELECT company_id INTO v_variant_company_id FROM item_variants WHERE id = NEW.item_variant_id;
  IF v_variant_company_id IS DISTINCT FROM v_po_company_id THEN
    RAISE EXCEPTION 'item_variant % does not belong to company %', NEW.item_variant_id, v_po_company_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_purchase_order_lines_check_variant
  BEFORE INSERT OR UPDATE ON purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION check_purchase_order_line_variant();

CREATE OR REPLACE FUNCTION check_purchase_order_line_immutable()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT document_status INTO v_status FROM purchase_orders
    WHERE id = COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'purchase order % is posted; its lines are immutable', COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_purchase_order_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION check_purchase_order_line_immutable();

CREATE OR REPLACE FUNCTION recompute_purchase_order_totals()
RETURNS TRIGGER AS $$
BEGIN
  SELECT COALESCE(SUM(net_amount), 0), COALESCE(SUM(vat_amount), 0), COALESCE(SUM(gross_amount), 0)
    INTO NEW.net_amount, NEW.vat_amount, NEW.gross_amount
    FROM purchase_order_lines WHERE purchase_order_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_purchase_orders_recompute_totals
  BEFORE INSERT OR UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION recompute_purchase_order_totals();

CREATE OR REPLACE FUNCTION touch_purchase_order_header()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE purchase_orders SET id = id WHERE id = COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_purchase_order_lines_touch_header
  AFTER INSERT OR UPDATE OR DELETE ON purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION touch_purchase_order_header();

-- Posting a PO just locks it (approval), no GL/journal involved.
CREATE OR REPLACE FUNCTION check_purchase_order_posting()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'purchase order % is posted and cannot be modified', OLD.id;
  END IF;

  IF NEW.document_status = 'posted' THEN
    IF NOT EXISTS (SELECT 1 FROM purchase_order_lines WHERE purchase_order_id = NEW.id) THEN
      RAISE EXCEPTION 'purchase order % has no lines and cannot be posted', NEW.id;
    END IF;
    NEW.posted_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_purchase_orders_check_posting
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION check_purchase_order_posting();

CREATE TRIGGER trg_purchase_orders_audit
  AFTER INSERT OR UPDATE OR DELETE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_purchase_order_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
