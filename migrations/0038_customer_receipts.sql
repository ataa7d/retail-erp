-- A customer receipt is a document like any other: draft -> posted, with
-- its own GL journal (Dr Bank/Cash, Cr Accounts Receivable), immutable
-- once posted. Allocation to specific sales_invoices is tracked
-- separately from the GL posting — a receipt can post fully unallocated
-- (unapplied cash) since the AR account balance is correct either way;
-- allocations only matter for which invoice ages out in ar_ageing (0040).

CREATE TABLE customer_receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id),
  customer_id     UUID NOT NULL REFERENCES customers(id),
  bank_account_id UUID REFERENCES bank_accounts(id), -- null for a cash-drawer receipt
  document_number TEXT NOT NULL,
  receipt_date    DATE NOT NULL,
  fiscal_period_id UUID NOT NULL REFERENCES fiscal_periods(id),
  payment_method  payment_method_type NOT NULL,
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reference       TEXT,
  document_status TEXT NOT NULL DEFAULT 'draft' CHECK (document_status IN ('draft', 'posted')),
  posted_at       TIMESTAMPTZ,
  posted_by       UUID REFERENCES users(id),
  journal_id      UUID REFERENCES journals(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES users(id),
  UNIQUE (company_id, document_number)
);

CREATE INDEX idx_customer_receipts_company ON customer_receipts(company_id);
CREATE INDEX idx_customer_receipts_customer ON customer_receipts(customer_id);

CREATE TABLE customer_receipt_allocations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  customer_receipt_id UUID NOT NULL REFERENCES customer_receipts(id),
  sales_invoice_id  UUID NOT NULL REFERENCES sales_invoices(id),
  allocated_amount  NUMERIC(14,2) NOT NULL CHECK (allocated_amount > 0)
);

CREATE INDEX idx_customer_receipt_allocations_receipt ON customer_receipt_allocations(customer_receipt_id);
CREATE INDEX idx_customer_receipt_allocations_invoice ON customer_receipt_allocations(sales_invoice_id);

CREATE OR REPLACE FUNCTION check_customer_receipt_refs_company()
RETURNS TRIGGER AS $$
DECLARE
  ref_company_id UUID;
BEGIN
  SELECT company_id INTO ref_company_id FROM customers WHERE id = NEW.customer_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'customer % does not belong to company %', NEW.customer_id, NEW.company_id;
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

CREATE TRIGGER trg_customer_receipts_check_refs
  BEFORE INSERT OR UPDATE ON customer_receipts
  FOR EACH ROW EXECUTE FUNCTION check_customer_receipt_refs_company();

-- An allocation cannot: (a) exceed the receipt's remaining unallocated
-- amount, (b) exceed the invoice's remaining open amount, or (c) target an
-- invoice from a different customer than the receipt.
CREATE OR REPLACE FUNCTION check_customer_receipt_allocation()
RETURNS TRIGGER AS $$
DECLARE
  v_receipt_company_id UUID;
  v_receipt_customer_id UUID;
  v_receipt_amount NUMERIC(14,2);
  v_already_allocated_on_receipt NUMERIC(14,2);
  v_invoice_customer_id UUID;
  v_invoice_gross NUMERIC(14,2);
  v_already_allocated_on_invoice NUMERIC(14,2);
BEGIN
  SELECT company_id, customer_id, amount INTO v_receipt_company_id, v_receipt_customer_id, v_receipt_amount
    FROM customer_receipts WHERE id = NEW.customer_receipt_id;

  IF NEW.company_id IS DISTINCT FROM v_receipt_company_id THEN
    RAISE EXCEPTION 'allocation company % does not match receipt % company', NEW.company_id, NEW.customer_receipt_id;
  END IF;

  SELECT customer_id, gross_amount INTO v_invoice_customer_id, v_invoice_gross
    FROM sales_invoices WHERE id = NEW.sales_invoice_id;

  IF v_invoice_customer_id IS DISTINCT FROM v_receipt_customer_id THEN
    RAISE EXCEPTION 'invoice % belongs to a different customer than receipt %', NEW.sales_invoice_id, NEW.customer_receipt_id;
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_already_allocated_on_receipt
    FROM customer_receipt_allocations WHERE customer_receipt_id = NEW.customer_receipt_id AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000');
  IF v_already_allocated_on_receipt + NEW.allocated_amount > v_receipt_amount THEN
    RAISE EXCEPTION 'allocation % exceeds receipt %''s remaining unallocated amount', NEW.allocated_amount, NEW.customer_receipt_id;
  END IF;

  SELECT COALESCE(SUM(cra.allocated_amount), 0) INTO v_already_allocated_on_invoice
    FROM customer_receipt_allocations cra
    JOIN customer_receipts cr ON cr.id = cra.customer_receipt_id
    WHERE cra.sales_invoice_id = NEW.sales_invoice_id
      AND cr.document_status = 'posted'
      AND cra.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000');
  IF v_already_allocated_on_invoice + NEW.allocated_amount > v_invoice_gross THEN
    RAISE EXCEPTION 'allocation % would exceed invoice %''s remaining open amount', NEW.allocated_amount, NEW.sales_invoice_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customer_receipt_allocations_check
  BEFORE INSERT OR UPDATE ON customer_receipt_allocations
  FOR EACH ROW EXECUTE FUNCTION check_customer_receipt_allocation();

CREATE OR REPLACE FUNCTION check_customer_receipt_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN OLD;
  END IF;
  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'customer receipt % is posted and cannot be modified or deleted', OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customer_receipts_check_delete
  BEFORE DELETE ON customer_receipts
  FOR EACH ROW EXECUTE FUNCTION check_customer_receipt_immutable();

CREATE OR REPLACE FUNCTION check_customer_receipt_allocation_immutable()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT document_status INTO v_status FROM customer_receipts
    WHERE id = COALESCE(NEW.customer_receipt_id, OLD.customer_receipt_id);
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'receipt % is posted; its allocations are immutable', COALESCE(NEW.customer_receipt_id, OLD.customer_receipt_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customer_receipt_allocations_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON customer_receipt_allocations
  FOR EACH ROW EXECUTE FUNCTION check_customer_receipt_allocation_immutable();

CREATE OR REPLACE FUNCTION check_customer_receipt_posting()
RETURNS TRIGGER AS $$
DECLARE
  v_journal_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'customer receipt % is posted and cannot be modified', OLD.id;
  END IF;

  IF NEW.document_status = 'posted' THEN
    IF NEW.journal_id IS NULL THEN
      RAISE EXCEPTION 'customer receipt % cannot be posted without a GL journal', NEW.id;
    END IF;
    SELECT document_status INTO v_journal_status FROM journals WHERE id = NEW.journal_id;
    IF v_journal_status IS DISTINCT FROM 'posted' THEN
      RAISE EXCEPTION 'customer receipt % journal % must be posted first', NEW.id, NEW.journal_id;
    END IF;
    NEW.posted_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customer_receipts_check_posting
  BEFORE UPDATE ON customer_receipts
  FOR EACH ROW EXECUTE FUNCTION check_customer_receipt_posting();

CREATE TRIGGER trg_customer_receipts_audit
  AFTER INSERT OR UPDATE OR DELETE ON customer_receipts
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_customer_receipt_allocations_audit
  AFTER INSERT OR UPDATE OR DELETE ON customer_receipt_allocations
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
