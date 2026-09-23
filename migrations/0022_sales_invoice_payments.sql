-- Payment breakdown for POS invoices (cash/card/credit/points/gift_card).
-- Required to fully cover the invoice total before a 'pos' invoice can
-- post — enforced in check_sales_invoice_posting (0021), not here, since
-- the check needs to run at the moment of posting, not at the moment a
-- payment row is added (a cashier may add rows one at a time before the
-- total is complete).

CREATE TYPE payment_method_type AS ENUM ('cash', 'card', 'credit', 'points', 'gift_card');

CREATE TABLE sales_invoice_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id),
  invoice_id      UUID NOT NULL REFERENCES sales_invoices(id),
  payment_method  payment_method_type NOT NULL,
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reference       TEXT, -- card auth code, gift card number, etc.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sales_invoice_payments_invoice ON sales_invoice_payments(invoice_id);
CREATE INDEX idx_sales_invoice_payments_company ON sales_invoice_payments(company_id);

CREATE OR REPLACE FUNCTION check_sales_invoice_payment_company()
RETURNS TRIGGER AS $$
DECLARE
  v_invoice_company_id UUID;
BEGIN
  SELECT company_id INTO v_invoice_company_id FROM sales_invoices WHERE id = NEW.invoice_id;
  IF NEW.company_id IS DISTINCT FROM v_invoice_company_id THEN
    RAISE EXCEPTION 'payment company % does not match invoice % company', NEW.company_id, NEW.invoice_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_invoice_payments_check_company
  BEFORE INSERT OR UPDATE ON sales_invoice_payments
  FOR EACH ROW EXECUTE FUNCTION check_sales_invoice_payment_company();

-- Payment rows are only editable while the invoice is still draft — once
-- posted, a payment correction is a separate receipt/refund (Phase 7), not
-- an edit here.
CREATE OR REPLACE FUNCTION check_sales_invoice_payment_immutable()
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
    RAISE EXCEPTION 'invoice % is posted; its payments are immutable', COALESCE(NEW.invoice_id, OLD.invoice_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_invoice_payments_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON sales_invoice_payments
  FOR EACH ROW EXECUTE FUNCTION check_sales_invoice_payment_immutable();

CREATE TRIGGER trg_sales_invoice_payments_audit
  AFTER INSERT OR UPDATE OR DELETE ON sales_invoice_payments
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
