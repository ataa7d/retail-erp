-- Purchase requisitions: the step BEFORE a purchase order in the
-- procurement chain (requisition -> approval -> PO -> goods receipt ->
-- supplier invoice). A requisition carries no price/supplier commitment --
-- just "someone needs these items" -- pricing and supplier selection
-- happen when it's converted into a PO. This is the first multi-state
-- document workflow in this schema (everything else is a plain
-- draft/posted binary); the state machine is:
--
--   draft --submit--> pending_approval --approve--> approved --convert--> converted_to_po
--                                       \-reject--> rejected
--
-- rejected and converted_to_po are terminal. Conversion is all-or-nothing
-- (one requisition becomes exactly one PO, in full) -- not the partial,
-- repeatable relationship goods_receipts has with purchase_orders, since
-- splitting one requisition across multiple suppliers/POs is a real but
-- rarer need that can be added later without breaking this shape.

CREATE TABLE purchase_requisitions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  store_id          UUID NOT NULL REFERENCES stores(id),
  document_number   TEXT NOT NULL,
  requisition_date  DATE NOT NULL,
  needed_by_date    DATE,
  notes             TEXT,
  document_status   TEXT NOT NULL DEFAULT 'draft'
                       CHECK (document_status IN ('draft', 'pending_approval', 'approved', 'rejected', 'converted_to_po')),
  submitted_at      TIMESTAMPTZ,
  decided_at        TIMESTAMPTZ,
  decided_by        UUID REFERENCES users(id),
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES users(id), -- the requester
  UNIQUE (company_id, document_number)
);

CREATE INDEX idx_purchase_requisitions_company ON purchase_requisitions(company_id);
CREATE INDEX idx_purchase_requisitions_store ON purchase_requisitions(store_id);
CREATE INDEX idx_purchase_requisitions_status ON purchase_requisitions(company_id, document_status);

CREATE TABLE purchase_requisition_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id),
  requisition_id  UUID NOT NULL REFERENCES purchase_requisitions(id),
  line_number     INTEGER NOT NULL,
  item_variant_id UUID NOT NULL REFERENCES item_variants(id),
  qty             NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  notes           TEXT,
  UNIQUE (requisition_id, line_number)
);

CREATE INDEX idx_purchase_requisition_lines_requisition ON purchase_requisition_lines(requisition_id);

-- A converted requisition's PO(s) link back here; nullable since most POs
-- are still created directly with no requisition behind them.
ALTER TABLE purchase_orders
  ADD COLUMN purchase_requisition_id UUID REFERENCES purchase_requisitions(id);

CREATE INDEX idx_purchase_orders_requisition ON purchase_orders(purchase_requisition_id);

CREATE OR REPLACE FUNCTION check_purchase_requisition_refs_company()
RETURNS TRIGGER AS $$
DECLARE
  ref_company_id UUID;
BEGIN
  SELECT company_id INTO ref_company_id FROM stores WHERE id = NEW.store_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'store % does not belong to company %', NEW.store_id, NEW.company_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_purchase_requisitions_check_refs
  BEFORE INSERT OR UPDATE ON purchase_requisitions
  FOR EACH ROW EXECUTE FUNCTION check_purchase_requisition_refs_company();

CREATE OR REPLACE FUNCTION check_purchase_requisition_line_variant()
RETURNS TRIGGER AS $$
DECLARE
  v_req_company_id UUID;
  v_variant_company_id UUID;
BEGIN
  SELECT company_id INTO v_req_company_id FROM purchase_requisitions WHERE id = NEW.requisition_id;
  IF NEW.company_id IS DISTINCT FROM v_req_company_id THEN
    RAISE EXCEPTION 'line company % does not match requisition % company', NEW.company_id, NEW.requisition_id;
  END IF;

  SELECT company_id INTO v_variant_company_id FROM item_variants WHERE id = NEW.item_variant_id;
  IF v_variant_company_id IS DISTINCT FROM v_req_company_id THEN
    RAISE EXCEPTION 'item_variant % does not belong to company %', NEW.item_variant_id, v_req_company_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_purchase_requisition_lines_check_variant
  BEFORE INSERT OR UPDATE ON purchase_requisition_lines
  FOR EACH ROW EXECUTE FUNCTION check_purchase_requisition_line_variant();

-- Lines are only ever editable while the header is still a draft -- once
-- submitted for approval, nobody (requester included) can quietly change
-- what's being asked for out from under the reviewer.
CREATE OR REPLACE FUNCTION check_purchase_requisition_line_immutable()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT document_status INTO v_status FROM purchase_requisitions
    WHERE id = COALESCE(NEW.requisition_id, OLD.requisition_id);
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'purchase requisition % is % and its lines are immutable', COALESCE(NEW.requisition_id, OLD.requisition_id), v_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_purchase_requisition_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON purchase_requisition_lines
  FOR EACH ROW EXECUTE FUNCTION check_purchase_requisition_line_immutable();

CREATE OR REPLACE FUNCTION check_purchase_requisition_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.document_status IN ('rejected', 'converted_to_po') THEN
    RAISE EXCEPTION 'purchase requisition % is % and cannot be modified', OLD.id, OLD.document_status;
  END IF;

  IF NEW.document_status IS DISTINCT FROM OLD.document_status THEN
    IF OLD.document_status = 'draft' AND NEW.document_status = 'pending_approval' THEN
      IF NOT EXISTS (SELECT 1 FROM purchase_requisition_lines WHERE requisition_id = NEW.id) THEN
        RAISE EXCEPTION 'purchase requisition % has no lines and cannot be submitted', NEW.id;
      END IF;
      NEW.submitted_at := now();

    ELSIF OLD.document_status = 'pending_approval' AND NEW.document_status = 'approved' THEN
      IF NEW.decided_by IS NULL THEN
        RAISE EXCEPTION 'purchase requisition % cannot be approved without decided_by', NEW.id;
      END IF;
      IF NEW.decided_by = NEW.created_by THEN
        RAISE EXCEPTION 'purchase requisition % cannot be approved by its own requester', NEW.id;
      END IF;
      NEW.decided_at := now();

    ELSIF OLD.document_status = 'pending_approval' AND NEW.document_status = 'rejected' THEN
      IF NEW.decided_by IS NULL THEN
        RAISE EXCEPTION 'purchase requisition % cannot be rejected without decided_by', NEW.id;
      END IF;
      IF NEW.rejection_reason IS NULL OR btrim(NEW.rejection_reason) = '' THEN
        RAISE EXCEPTION 'purchase requisition % cannot be rejected without a reason', NEW.id;
      END IF;
      NEW.decided_at := now();

    ELSIF OLD.document_status = 'approved' AND NEW.document_status = 'converted_to_po' THEN
      NULL; -- driven by the app once the PO is created, no extra validation here

    ELSE
      RAISE EXCEPTION 'illegal purchase requisition status transition from % to %', OLD.document_status, NEW.document_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_purchase_requisitions_check_status_transition
  BEFORE UPDATE ON purchase_requisitions
  FOR EACH ROW EXECUTE FUNCTION check_purchase_requisition_status_transition();

CREATE OR REPLACE FUNCTION check_purchase_requisition_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN OLD;
  END IF;
  IF OLD.document_status <> 'draft' THEN
    RAISE EXCEPTION 'purchase requisition % is % and cannot be deleted', OLD.id, OLD.document_status;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_purchase_requisitions_check_delete
  BEFORE DELETE ON purchase_requisitions
  FOR EACH ROW EXECUTE FUNCTION check_purchase_requisition_delete();

CREATE TRIGGER trg_purchase_requisitions_audit
  AFTER INSERT OR UPDATE OR DELETE ON purchase_requisitions
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_purchase_requisition_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON purchase_requisition_lines
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
