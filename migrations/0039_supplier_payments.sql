-- Mirrors customer_receipts (0038) for the AP side: Dr Accounts Payable,
-- Cr Bank/Cash. Allocation to specific supplier_invoices is likewise
-- tracked separately from the GL posting.

CREATE TABLE supplier_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  supplier_id       UUID NOT NULL REFERENCES suppliers(id),
  bank_account_id   UUID REFERENCES bank_accounts(id),
  document_number   TEXT NOT NULL,
  payment_date      DATE NOT NULL,
  fiscal_period_id  UUID NOT NULL REFERENCES fiscal_periods(id),
  payment_method    payment_method_type NOT NULL,
  amount            NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reference         TEXT,
  document_status   TEXT NOT NULL DEFAULT 'draft' CHECK (document_status IN ('draft', 'posted')),
  posted_at         TIMESTAMPTZ,
  posted_by         UUID REFERENCES users(id),
  journal_id        UUID REFERENCES journals(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES users(id),
  UNIQUE (company_id, document_number)
);

CREATE INDEX idx_supplier_payments_company ON supplier_payments(company_id);
CREATE INDEX idx_supplier_payments_supplier ON supplier_payments(supplier_id);

CREATE TABLE supplier_payment_allocations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES companies(id),
  supplier_payment_id   UUID NOT NULL REFERENCES supplier_payments(id),
  supplier_invoice_id   UUID NOT NULL REFERENCES supplier_invoices(id),
  allocated_amount      NUMERIC(14,2) NOT NULL CHECK (allocated_amount > 0)
);

CREATE INDEX idx_supplier_payment_allocations_payment ON supplier_payment_allocations(supplier_payment_id);
CREATE INDEX idx_supplier_payment_allocations_invoice ON supplier_payment_allocations(supplier_invoice_id);

CREATE OR REPLACE FUNCTION check_supplier_payment_refs_company()
RETURNS TRIGGER AS $$
DECLARE
  ref_company_id UUID;
BEGIN
  SELECT company_id INTO ref_company_id FROM suppliers WHERE id = NEW.supplier_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'supplier % does not belong to company %', NEW.supplier_id, NEW.company_id;
  END IF;

  SELECT company_id INTO ref_company_id FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'fiscal period % does not belong to company %', NEW.fiscal_period_id, NEW.company_id;
  END IF;

  IF NEW.bank_account_id IS NOT NULL THEN
    SELECT company_id INTO ref_company_id FROM bank_accounts WHERE id = NEW.bank_account_id;
    IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'bank account % does not belong to company %', NEW.bank_account_id, NEW.company_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_payments_check_refs
  BEFORE INSERT OR UPDATE ON supplier_payments
  FOR EACH ROW EXECUTE FUNCTION check_supplier_payment_refs_company();

CREATE OR REPLACE FUNCTION check_supplier_payment_allocation()
RETURNS TRIGGER AS $$
DECLARE
  v_payment_company_id UUID;
  v_payment_supplier_id UUID;
  v_payment_amount NUMERIC(14,2);
  v_already_allocated_on_payment NUMERIC(14,2);
  v_invoice_supplier_id UUID;
  v_invoice_gross NUMERIC(14,2);
  v_already_allocated_on_invoice NUMERIC(14,2);
BEGIN
  SELECT company_id, supplier_id, amount INTO v_payment_company_id, v_payment_supplier_id, v_payment_amount
    FROM supplier_payments WHERE id = NEW.supplier_payment_id;

  IF NEW.company_id IS DISTINCT FROM v_payment_company_id THEN
    RAISE EXCEPTION 'allocation company % does not match payment % company', NEW.company_id, NEW.supplier_payment_id;
  END IF;

  SELECT supplier_id, gross_amount INTO v_invoice_supplier_id, v_invoice_gross
    FROM supplier_invoices WHERE id = NEW.supplier_invoice_id;

  IF v_invoice_supplier_id IS DISTINCT FROM v_payment_supplier_id THEN
    RAISE EXCEPTION 'invoice % belongs to a different supplier than payment %', NEW.supplier_invoice_id, NEW.supplier_payment_id;
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_already_allocated_on_payment
    FROM supplier_payment_allocations WHERE supplier_payment_id = NEW.supplier_payment_id AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000');
  IF v_already_allocated_on_payment + NEW.allocated_amount > v_payment_amount THEN
    RAISE EXCEPTION 'allocation % exceeds payment %''s remaining unallocated amount', NEW.allocated_amount, NEW.supplier_payment_id;
  END IF;

  SELECT COALESCE(SUM(spa.allocated_amount), 0) INTO v_already_allocated_on_invoice
    FROM supplier_payment_allocations spa
    JOIN supplier_payments sp ON sp.id = spa.supplier_payment_id
    WHERE spa.supplier_invoice_id = NEW.supplier_invoice_id
      AND sp.document_status = 'posted'
      AND spa.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000');
  IF v_already_allocated_on_invoice + NEW.allocated_amount > v_invoice_gross THEN
    RAISE EXCEPTION 'allocation % would exceed invoice %''s remaining open amount', NEW.allocated_amount, NEW.supplier_invoice_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_payment_allocations_check
  BEFORE INSERT OR UPDATE ON supplier_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION check_supplier_payment_allocation();

CREATE OR REPLACE FUNCTION check_supplier_payment_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN OLD;
  END IF;
  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'supplier payment % is posted and cannot be modified or deleted', OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_payments_check_delete
  BEFORE DELETE ON supplier_payments
  FOR EACH ROW EXECUTE FUNCTION check_supplier_payment_immutable();

CREATE OR REPLACE FUNCTION check_supplier_payment_allocation_immutable()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT document_status INTO v_status FROM supplier_payments
    WHERE id = COALESCE(NEW.supplier_payment_id, OLD.supplier_payment_id);
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'payment % is posted; its allocations are immutable', COALESCE(NEW.supplier_payment_id, OLD.supplier_payment_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_payment_allocations_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON supplier_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION check_supplier_payment_allocation_immutable();

CREATE OR REPLACE FUNCTION check_supplier_payment_posting()
RETURNS TRIGGER AS $$
DECLARE
  v_journal_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'supplier payment % is posted and cannot be modified', OLD.id;
  END IF;

  IF NEW.document_status = 'posted' THEN
    IF NEW.journal_id IS NULL THEN
      RAISE EXCEPTION 'supplier payment % cannot be posted without a GL journal', NEW.id;
    END IF;
    SELECT document_status INTO v_journal_status FROM journals WHERE id = NEW.journal_id;
    IF v_journal_status IS DISTINCT FROM 'posted' THEN
      RAISE EXCEPTION 'supplier payment % journal % must be posted first', NEW.id, NEW.journal_id;
    END IF;
    NEW.posted_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_payments_check_posting
  BEFORE UPDATE ON supplier_payments
  FOR EACH ROW EXECUTE FUNCTION check_supplier_payment_posting();

CREATE TRIGGER trg_supplier_payments_audit
  AFTER INSERT OR UPDATE OR DELETE ON supplier_payments
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_supplier_payment_allocations_audit
  AFTER INSERT OR UPDATE OR DELETE ON supplier_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
