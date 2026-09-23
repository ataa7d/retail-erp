-- Goods receipt: the point stock physically enters a store and the GRNI
-- (goods-received-not-invoiced) liability is accrued — Dr Inventory /
-- Cr GRNI for the merchandise portion, Cr Landed Cost Accrual for any
-- freight/customs/COC charges folded into unit_cost. unit_cost on each
-- line is base_unit_cost (from the PO) plus its allocated share of
-- goods_receipt_charges, computed once at posting time — landed cost is
-- never applied retroactively to stock that may have already sold.

CREATE TABLE goods_receipts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  store_id          UUID NOT NULL REFERENCES stores(id),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
  supplier_id       UUID NOT NULL REFERENCES suppliers(id),
  document_number   TEXT NOT NULL,
  receipt_date      DATE NOT NULL,
  fiscal_period_id  UUID NOT NULL REFERENCES fiscal_periods(id),
  document_status   TEXT NOT NULL DEFAULT 'draft' CHECK (document_status IN ('draft', 'posted')),
  posted_at         TIMESTAMPTZ,
  posted_by         UUID REFERENCES users(id),
  journal_id        UUID REFERENCES journals(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES users(id),
  UNIQUE (company_id, document_number)
);

CREATE INDEX idx_goods_receipts_company ON goods_receipts(company_id);
CREATE INDEX idx_goods_receipts_po ON goods_receipts(purchase_order_id);

CREATE TABLE goods_receipt_lines (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             UUID NOT NULL REFERENCES companies(id),
  goods_receipt_id       UUID NOT NULL REFERENCES goods_receipts(id),
  line_number            INTEGER NOT NULL,
  purchase_order_line_id UUID NOT NULL REFERENCES purchase_order_lines(id),
  item_variant_id        UUID NOT NULL REFERENCES item_variants(id),
  qty_received           NUMERIC(14,3) NOT NULL CHECK (qty_received > 0),
  base_unit_cost         NUMERIC(14,4) NOT NULL CHECK (base_unit_cost >= 0), -- from the PO line, before landed cost
  landed_cost_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (landed_cost_amount >= 0),
  unit_cost              NUMERIC(14,4) NOT NULL CHECK (unit_cost >= 0), -- base + landed_cost_amount / qty_received
  UNIQUE (goods_receipt_id, line_number)
);

CREATE INDEX idx_goods_receipt_lines_company ON goods_receipt_lines(company_id);
CREATE INDEX idx_goods_receipt_lines_receipt ON goods_receipt_lines(goods_receipt_id);
CREATE INDEX idx_goods_receipt_lines_po_line ON goods_receipt_lines(purchase_order_line_id);

CREATE TABLE goods_receipt_charges (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES companies(id),
  goods_receipt_id   UUID NOT NULL REFERENCES goods_receipts(id),
  charge_type        TEXT NOT NULL, -- 'freight', 'customs', 'coc', 'other'
  amount             NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  allocation_basis   TEXT NOT NULL DEFAULT 'value' CHECK (allocation_basis IN ('value', 'weight')),
  description        TEXT
);

CREATE INDEX idx_goods_receipt_charges_receipt ON goods_receipt_charges(goods_receipt_id);

CREATE OR REPLACE FUNCTION check_goods_receipt_refs_company()
RETURNS TRIGGER AS $$
DECLARE
  ref_company_id UUID;
  v_po_status TEXT;
BEGIN
  SELECT company_id INTO ref_company_id FROM stores WHERE id = NEW.store_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'store % does not belong to company %', NEW.store_id, NEW.company_id;
  END IF;

  SELECT company_id, document_status INTO ref_company_id, v_po_status FROM purchase_orders WHERE id = NEW.purchase_order_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'purchase order % does not belong to company %', NEW.purchase_order_id, NEW.company_id;
  END IF;
  IF v_po_status IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION 'purchase order % must be approved (posted) before receiving against it', NEW.purchase_order_id;
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

CREATE TRIGGER trg_goods_receipts_check_refs
  BEFORE INSERT OR UPDATE ON goods_receipts
  FOR EACH ROW EXECUTE FUNCTION check_goods_receipt_refs_company();

-- Three-way match, quantity side: the PO line's item must match, and
-- cumulative received qty (existing + this line) cannot exceed the
-- ordered qty by more than the company's configured tolerance.
CREATE OR REPLACE FUNCTION check_goods_receipt_line()
RETURNS TRIGGER AS $$
DECLARE
  v_receipt_company_id UUID;
  v_po_line_item_variant_id UUID;
  v_po_line_qty NUMERIC(14,3);
  v_po_line_received_qty NUMERIC(14,3);
  v_tolerance_percent NUMERIC(5,2);
  v_max_allowed NUMERIC(14,3);
BEGIN
  SELECT company_id INTO v_receipt_company_id FROM goods_receipts WHERE id = NEW.goods_receipt_id;
  IF NEW.company_id IS DISTINCT FROM v_receipt_company_id THEN
    RAISE EXCEPTION 'line company % does not match goods receipt % company', NEW.company_id, NEW.goods_receipt_id;
  END IF;

  SELECT item_variant_id, qty, received_qty INTO v_po_line_item_variant_id, v_po_line_qty, v_po_line_received_qty
    FROM purchase_order_lines WHERE id = NEW.purchase_order_line_id;

  IF v_po_line_item_variant_id IS DISTINCT FROM NEW.item_variant_id THEN
    RAISE EXCEPTION 'goods receipt line item_variant % does not match purchase order line item_variant %', NEW.item_variant_id, v_po_line_item_variant_id;
  END IF;

  SELECT po_qty_tolerance_percent INTO v_tolerance_percent FROM companies WHERE id = v_receipt_company_id;
  v_max_allowed := v_po_line_qty * (1 + v_tolerance_percent / 100);

  IF v_po_line_received_qty + NEW.qty_received > v_max_allowed THEN
    RAISE EXCEPTION 'receiving % would exceed the tolerated quantity for PO line % (already received %, ordered %, tolerance %%%)',
      NEW.qty_received, NEW.purchase_order_line_id, v_po_line_received_qty, v_po_line_qty, v_tolerance_percent;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_goods_receipt_lines_check
  BEFORE INSERT OR UPDATE ON goods_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION check_goods_receipt_line();

CREATE OR REPLACE FUNCTION check_goods_receipt_line_immutable()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT document_status INTO v_status FROM goods_receipts
    WHERE id = COALESCE(NEW.goods_receipt_id, OLD.goods_receipt_id);
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'goods receipt % is posted; its lines are immutable', COALESCE(NEW.goods_receipt_id, OLD.goods_receipt_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_goods_receipt_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON goods_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION check_goods_receipt_line_immutable();

CREATE TRIGGER trg_goods_receipt_charges_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON goods_receipt_charges
  FOR EACH ROW EXECUTE FUNCTION check_goods_receipt_line_immutable(); -- reuses the same "parent posted?" check; goods_receipt_id column name matches

CREATE OR REPLACE FUNCTION check_goods_receipt_posting()
RETURNS TRIGGER AS $$
DECLARE
  v_journal_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'goods receipt % is posted and cannot be modified', OLD.id;
  END IF;

  IF NEW.document_status = 'posted' THEN
    IF NEW.journal_id IS NULL THEN
      RAISE EXCEPTION 'goods receipt % cannot be posted without a GL journal', NEW.id;
    END IF;
    SELECT document_status INTO v_journal_status FROM journals WHERE id = NEW.journal_id;
    IF v_journal_status IS DISTINCT FROM 'posted' THEN
      RAISE EXCEPTION 'goods receipt % journal % must be posted first', NEW.id, NEW.journal_id;
    END IF;
    NEW.posted_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_goods_receipts_check_posting
  BEFORE UPDATE ON goods_receipts
  FOR EACH ROW EXECUTE FUNCTION check_goods_receipt_posting();

-- Once a goods receipt posts, fold its lines' qty into the linked PO
-- lines' received_qty — a full recompute from all posted receipts against
-- each PO line, not an increment.
CREATE OR REPLACE FUNCTION recompute_po_line_received_qty()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.document_status = 'posted' AND OLD.document_status IS DISTINCT FROM 'posted' THEN
    UPDATE purchase_order_lines pol
      SET received_qty = COALESCE((
        SELECT SUM(grl.qty_received)
        FROM goods_receipt_lines grl
        JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id
        WHERE grl.purchase_order_line_id = pol.id AND gr.document_status = 'posted'
      ), 0)
      WHERE pol.id IN (SELECT purchase_order_line_id FROM goods_receipt_lines WHERE goods_receipt_id = NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_goods_receipts_recompute_po_received
  AFTER UPDATE ON goods_receipts
  FOR EACH ROW EXECUTE FUNCTION recompute_po_line_received_qty();

CREATE TRIGGER trg_goods_receipts_audit
  AFTER INSERT OR UPDATE OR DELETE ON goods_receipts
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_goods_receipt_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON goods_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_goods_receipt_charges_audit
  AFTER INSERT OR UPDATE OR DELETE ON goods_receipt_charges
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
