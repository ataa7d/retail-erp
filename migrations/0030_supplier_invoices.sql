-- supplier_invoices is the AP side: clears the GRNI accrual made at
-- receipt time, books any price variance against Purchase Price Variance,
-- claims input VAT, and credits Accounts Payable. Every line anchors to a
-- specific goods_receipt_line (the quantity side of 3-way match already
-- happened at receipt time; this is where price is matched).

CREATE TABLE supplier_invoices (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES companies(id),
  supplier_id             UUID NOT NULL REFERENCES suppliers(id),
  purchase_order_id       UUID NOT NULL REFERENCES purchase_orders(id),
  supplier_invoice_number TEXT NOT NULL, -- the supplier's own reference, for duplicate-entry checking
  document_number         TEXT NOT NULL, -- our internal document number
  invoice_date            DATE NOT NULL,
  fiscal_period_id        UUID NOT NULL REFERENCES fiscal_periods(id),
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
  UNIQUE (company_id, supplier_id, supplier_invoice_number),
  CHECK (fn_amounts_balance(net_amount, vat_amount, gross_amount))
);

CREATE INDEX idx_supplier_invoices_company ON supplier_invoices(company_id);
CREATE INDEX idx_supplier_invoices_supplier ON supplier_invoices(supplier_id);
CREATE INDEX idx_supplier_invoices_po ON supplier_invoices(purchase_order_id);

CREATE TABLE supplier_invoice_lines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES companies(id),
  supplier_invoice_id   UUID NOT NULL REFERENCES supplier_invoices(id),
  line_number           INTEGER NOT NULL,
  goods_receipt_line_id UUID NOT NULL REFERENCES goods_receipt_lines(id),
  item_variant_id       UUID NOT NULL REFERENCES item_variants(id),
  qty                   NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  unit_price            NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  vat_rate              NUMERIC(5,2) NOT NULL CHECK (vat_rate >= 0),
  price_includes_vat    BOOLEAN NOT NULL DEFAULT false,
  net_amount            NUMERIC(14,2) NOT NULL,
  vat_amount            NUMERIC(14,2) NOT NULL,
  gross_amount          NUMERIC(14,2) NOT NULL,
  UNIQUE (supplier_invoice_id, line_number),
  CHECK (fn_amounts_balance(net_amount, vat_amount, gross_amount))
);

CREATE INDEX idx_supplier_invoice_lines_company ON supplier_invoice_lines(company_id);
CREATE INDEX idx_supplier_invoice_lines_invoice ON supplier_invoice_lines(supplier_invoice_id);
CREATE INDEX idx_supplier_invoice_lines_gr_line ON supplier_invoice_lines(goods_receipt_line_id);

CREATE OR REPLACE FUNCTION check_supplier_invoice_refs_company()
RETURNS TRIGGER AS $$
DECLARE
  ref_company_id UUID;
BEGIN
  SELECT company_id INTO ref_company_id FROM suppliers WHERE id = NEW.supplier_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'supplier % does not belong to company %', NEW.supplier_id, NEW.company_id;
  END IF;

  SELECT company_id INTO ref_company_id FROM purchase_orders WHERE id = NEW.purchase_order_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'purchase order % does not belong to company %', NEW.purchase_order_id, NEW.company_id;
  END IF;

  SELECT company_id INTO ref_company_id FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'fiscal period % does not belong to company %', NEW.fiscal_period_id, NEW.company_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_invoices_check_refs
  BEFORE INSERT OR UPDATE ON supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION check_supplier_invoice_refs_company();

-- Three-way match, quantity side (already-received check): cumulative
-- invoiced qty for this goods_receipt_line (across every posted supplier
-- invoice, excluding this one) plus this line's qty cannot exceed what was
-- actually received. Price tolerance is checked at posting time (below),
-- not here, mirroring the credit-note pattern: editable freely while
-- draft, authoritative check only at the moment of posting.
CREATE OR REPLACE FUNCTION check_supplier_invoice_line()
RETURNS TRIGGER AS $$
DECLARE
  v_invoice_company_id UUID;
  v_gr_line_item_variant_id UUID;
BEGIN
  SELECT company_id INTO v_invoice_company_id FROM supplier_invoices WHERE id = NEW.supplier_invoice_id;
  IF NEW.company_id IS DISTINCT FROM v_invoice_company_id THEN
    RAISE EXCEPTION 'line company % does not match supplier invoice % company', NEW.company_id, NEW.supplier_invoice_id;
  END IF;

  SELECT item_variant_id INTO v_gr_line_item_variant_id FROM goods_receipt_lines WHERE id = NEW.goods_receipt_line_id;
  IF v_gr_line_item_variant_id IS DISTINCT FROM NEW.item_variant_id THEN
    RAISE EXCEPTION 'supplier invoice line item_variant % does not match goods receipt line item_variant %', NEW.item_variant_id, v_gr_line_item_variant_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_invoice_lines_check
  BEFORE INSERT OR UPDATE ON supplier_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION check_supplier_invoice_line();

CREATE OR REPLACE FUNCTION check_supplier_invoice_line_immutable()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT document_status INTO v_status FROM supplier_invoices
    WHERE id = COALESCE(NEW.supplier_invoice_id, OLD.supplier_invoice_id);
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'supplier invoice % is posted; its lines are immutable', COALESCE(NEW.supplier_invoice_id, OLD.supplier_invoice_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_invoice_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON supplier_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION check_supplier_invoice_line_immutable();

CREATE OR REPLACE FUNCTION recompute_supplier_invoice_totals()
RETURNS TRIGGER AS $$
BEGIN
  SELECT COALESCE(SUM(net_amount), 0), COALESCE(SUM(vat_amount), 0), COALESCE(SUM(gross_amount), 0)
    INTO NEW.net_amount, NEW.vat_amount, NEW.gross_amount
    FROM supplier_invoice_lines WHERE supplier_invoice_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_invoices_recompute_totals
  BEFORE INSERT OR UPDATE ON supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION recompute_supplier_invoice_totals();

CREATE OR REPLACE FUNCTION touch_supplier_invoice_header()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE supplier_invoices SET id = id WHERE id = COALESCE(NEW.supplier_invoice_id, OLD.supplier_invoice_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_invoice_lines_touch_header
  AFTER INSERT OR UPDATE OR DELETE ON supplier_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION touch_supplier_invoice_header();

-- The authoritative 3-way-match checks: qty (cumulative across all posted
-- invoices for each goods_receipt_line, never exceeding what was received)
-- and price (variance against the GR line's base_unit_cost within the
-- company's configured tolerance). Both checked only at the moment of
-- posting, same reasoning as journal balance / credit note quantity.
CREATE OR REPLACE FUNCTION check_supplier_invoice_posting()
RETURNS TRIGGER AS $$
DECLARE
  v_journal_status TEXT;
  v_tolerance_percent NUMERIC(5,2);
  v_line RECORD;
  v_gr_qty NUMERIC(14,3);
  v_gr_base_cost NUMERIC(14,4);
  v_already_invoiced_qty NUMERIC(14,3);
  v_price_variance_percent NUMERIC;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'supplier invoice % is posted and cannot be modified', OLD.id;
  END IF;

  IF NEW.document_status = 'posted' THEN
    IF NEW.journal_id IS NULL THEN
      RAISE EXCEPTION 'supplier invoice % cannot be posted without a GL journal', NEW.id;
    END IF;
    SELECT document_status INTO v_journal_status FROM journals WHERE id = NEW.journal_id;
    IF v_journal_status IS DISTINCT FROM 'posted' THEN
      RAISE EXCEPTION 'supplier invoice % journal % must be posted first', NEW.id, NEW.journal_id;
    END IF;

    SELECT po_price_tolerance_percent INTO v_tolerance_percent FROM companies WHERE id = NEW.company_id;

    FOR v_line IN SELECT goods_receipt_line_id, qty, unit_price FROM supplier_invoice_lines WHERE supplier_invoice_id = NEW.id LOOP
      SELECT qty_received, base_unit_cost INTO v_gr_qty, v_gr_base_cost
        FROM goods_receipt_lines WHERE id = v_line.goods_receipt_line_id;

      SELECT COALESCE(SUM(sil.qty), 0) INTO v_already_invoiced_qty
        FROM supplier_invoice_lines sil
        JOIN supplier_invoices si ON si.id = sil.supplier_invoice_id
        WHERE sil.goods_receipt_line_id = v_line.goods_receipt_line_id
          AND si.document_status = 'posted'
          AND si.id <> NEW.id;

      IF v_already_invoiced_qty + v_line.qty > v_gr_qty THEN
        RAISE EXCEPTION 'goods receipt line % : invoicing % would exceed quantity received (% already invoiced of %)',
          v_line.goods_receipt_line_id, v_line.qty, v_already_invoiced_qty, v_gr_qty;
      END IF;

      IF v_gr_base_cost > 0 THEN
        v_price_variance_percent := ABS(v_line.unit_price - v_gr_base_cost) / v_gr_base_cost * 100;
        IF v_price_variance_percent > v_tolerance_percent THEN
          RAISE EXCEPTION 'goods receipt line % : invoice price % differs from received cost % by %%% (tolerance %%%)',
            v_line.goods_receipt_line_id, v_line.unit_price, v_gr_base_cost, ROUND(v_price_variance_percent, 2), v_tolerance_percent;
        END IF;
      END IF;
    END LOOP;

    NEW.posted_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_invoices_check_posting
  BEFORE UPDATE ON supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION check_supplier_invoice_posting();

CREATE TRIGGER trg_supplier_invoices_audit
  AFTER INSERT OR UPDATE OR DELETE ON supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_supplier_invoice_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON supplier_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
