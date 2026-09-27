-- Cash shifts: opening/closing a POS device's cash drawer for a day, with a
-- Z-report reconciling expected vs counted cash. A shift is scoped to a
-- device (not a user) since a device is already the unit POS invoices are
-- issued against (sales_invoices.issued_by_device_id, migration 0043) --
-- the Z-report is computed by joining sales_invoices/sales_invoice_payments
-- to a shift's device_id and time window, not by tagging every invoice with
-- a shift_id, so offline sync (which already carries device_id) needs no
-- changes at all.

CREATE TABLE cash_shifts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             UUID NOT NULL REFERENCES companies(id),
  store_id               UUID NOT NULL REFERENCES stores(id),
  device_id              UUID NOT NULL REFERENCES pos_devices(id),
  status                 TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opening_float          NUMERIC(14,2) NOT NULL CHECK (opening_float >= 0),
  opened_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_by              UUID NOT NULL REFERENCES users(id),
  opening_notes          TEXT,
  closing_float_counted  NUMERIC(14,2) CHECK (closing_float_counted >= 0),
  closed_at              TIMESTAMPTZ,
  closed_by              UUID REFERENCES users(id),
  closing_notes          TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'open') = (closed_at IS NULL)),
  CHECK (status = 'open' OR closing_float_counted IS NOT NULL)
);

CREATE INDEX idx_cash_shifts_company ON cash_shifts(company_id);
CREATE INDEX idx_cash_shifts_device ON cash_shifts(device_id);

-- A device can only have one open shift at a time -- opening a second
-- without closing the first would make every subsequent sale ambiguous
-- about which drawer it belongs to.
CREATE UNIQUE INDEX idx_cash_shifts_one_open_per_device ON cash_shifts(device_id) WHERE status = 'open';

CREATE OR REPLACE FUNCTION check_cash_shift_refs_company()
RETURNS TRIGGER AS $$
DECLARE
  v_device_company_id UUID;
  v_device_store_id UUID;
BEGIN
  SELECT company_id, store_id INTO v_device_company_id, v_device_store_id FROM pos_devices WHERE id = NEW.device_id;
  IF v_device_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'device % does not belong to company %', NEW.device_id, NEW.company_id;
  END IF;
  IF v_device_store_id IS DISTINCT FROM NEW.store_id THEN
    RAISE EXCEPTION 'device % does not belong to store %', NEW.device_id, NEW.store_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cash_shifts_check_refs
  BEFORE INSERT OR UPDATE ON cash_shifts
  FOR EACH ROW EXECUTE FUNCTION check_cash_shift_refs_company();

-- Once closed, a shift is a historical record -- reopening or re-editing it
-- would let someone quietly change the numbers after the drawer's already
-- been reconciled and cash moved to the safe.
CREATE OR REPLACE FUNCTION check_cash_shift_immutable_once_closed()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'cash shift % is closed and cannot be modified', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cash_shifts_immutable_once_closed
  BEFORE UPDATE ON cash_shifts
  FOR EACH ROW EXECUTE FUNCTION check_cash_shift_immutable_once_closed();

CREATE TRIGGER trg_cash_shifts_audit
  AFTER INSERT OR UPDATE OR DELETE ON cash_shifts
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

INSERT INTO permissions (module, action, code, description) VALUES
  ('sales', 'open_cash_shift', 'sales.cash_shift.open', 'Open and close a POS device''s cash shift'),
  ('sales', 'view_cash_shift', 'sales.cash_shift.view', 'View cash shift history and Z-reports for any device');
