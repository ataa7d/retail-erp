-- Phase 9: payroll. One payroll_run per fiscal period (a company runs
-- payroll once a month, not ad hoc mid-period — same simplification as
-- depreciation_runs in 0044), draft -> posted with one aggregated GL
-- journal. No disbursement/bank-file generation — actually paying the net
-- salaries payable is out of scope for this phase (it would look like a
-- supplier-payment-style document against the 2210 Salaries Payable
-- account, following the exact pattern customer_receipts/supplier_payments
-- already established in Phase 7, but is not built here).

CREATE TABLE payroll_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  fiscal_period_id  UUID NOT NULL REFERENCES fiscal_periods(id),
  document_number   TEXT NOT NULL,
  pay_period_start  DATE NOT NULL,
  pay_period_end    DATE NOT NULL,
  run_date          DATE NOT NULL,
  document_status   TEXT NOT NULL DEFAULT 'draft' CHECK (document_status IN ('draft', 'posted')),
  posted_at         TIMESTAMPTZ,
  posted_by         UUID REFERENCES users(id),
  journal_id        UUID REFERENCES journals(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES users(id),
  UNIQUE (company_id, document_number),
  UNIQUE (company_id, fiscal_period_id),
  CHECK (pay_period_end >= pay_period_start)
);

CREATE INDEX idx_payroll_runs_company ON payroll_runs(company_id);

CREATE TABLE payroll_run_lines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES companies(id),
  payroll_run_id        UUID NOT NULL REFERENCES payroll_runs(id),
  employee_id           UUID NOT NULL REFERENCES employees(id),
  basic_salary          NUMERIC(14,2) NOT NULL CHECK (basic_salary >= 0),
  housing_allowance     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (housing_allowance >= 0),
  other_allowances      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (other_allowances >= 0),
  gross_pay             NUMERIC(14,2) NOT NULL CHECK (gross_pay >= 0),
  gosi_employee_amount  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (gosi_employee_amount >= 0),
  gosi_employer_amount  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (gosi_employer_amount >= 0),
  net_pay               NUMERIC(14,2) NOT NULL CHECK (net_pay >= 0),
  UNIQUE (payroll_run_id, employee_id),
  CHECK (gross_pay = basic_salary + housing_allowance + other_allowances),
  CHECK (net_pay = gross_pay - gosi_employee_amount)
);

CREATE INDEX idx_payroll_run_lines_run ON payroll_run_lines(payroll_run_id);
CREATE INDEX idx_payroll_run_lines_employee ON payroll_run_lines(employee_id);

CREATE OR REPLACE FUNCTION check_payroll_refs_company()
RETURNS TRIGGER AS $$
DECLARE ref_company_id UUID;
BEGIN
  SELECT company_id INTO ref_company_id FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'fiscal period % does not belong to company %', NEW.fiscal_period_id, NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payroll_runs_check_refs
  BEFORE INSERT OR UPDATE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION check_payroll_refs_company();

CREATE OR REPLACE FUNCTION check_payroll_run_line_employee()
RETURNS TRIGGER AS $$
DECLARE v_run_company_id UUID;
DECLARE v_employee_company_id UUID;
BEGIN
  SELECT company_id INTO v_run_company_id FROM payroll_runs WHERE id = NEW.payroll_run_id;
  IF NEW.company_id IS DISTINCT FROM v_run_company_id THEN
    RAISE EXCEPTION 'line company % does not match payroll run % company', NEW.company_id, NEW.payroll_run_id;
  END IF;
  SELECT company_id INTO v_employee_company_id FROM employees WHERE id = NEW.employee_id;
  IF v_employee_company_id IS DISTINCT FROM v_run_company_id THEN
    RAISE EXCEPTION 'employee % does not belong to company %', NEW.employee_id, v_run_company_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payroll_run_lines_check_employee
  BEFORE INSERT OR UPDATE ON payroll_run_lines
  FOR EACH ROW EXECUTE FUNCTION check_payroll_run_line_employee();

CREATE OR REPLACE FUNCTION check_payroll_run_line_immutable()
RETURNS TRIGGER AS $$
DECLARE v_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT document_status INTO v_status FROM payroll_runs WHERE id = COALESCE(NEW.payroll_run_id, OLD.payroll_run_id);
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'payroll run % is posted; its lines are immutable', COALESCE(NEW.payroll_run_id, OLD.payroll_run_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payroll_run_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON payroll_run_lines
  FOR EACH ROW EXECUTE FUNCTION check_payroll_run_line_immutable();

CREATE OR REPLACE FUNCTION check_payroll_run_posting()
RETURNS TRIGGER AS $$
DECLARE v_journal_status TEXT;
DECLARE v_line_count INTEGER;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;
  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'payroll run % is posted and cannot be modified', OLD.id;
  END IF;
  IF NEW.document_status = 'posted' THEN
    SELECT count(*) INTO v_line_count FROM payroll_run_lines WHERE payroll_run_id = NEW.id;
    IF v_line_count = 0 THEN
      RAISE EXCEPTION 'payroll run % has no lines', NEW.id;
    END IF;
    IF NEW.journal_id IS NULL THEN
      RAISE EXCEPTION 'payroll run % cannot be posted without a GL journal', NEW.id;
    END IF;
    SELECT document_status INTO v_journal_status FROM journals WHERE id = NEW.journal_id;
    IF v_journal_status IS DISTINCT FROM 'posted' THEN
      RAISE EXCEPTION 'payroll run % journal % must be posted first', NEW.id, NEW.journal_id;
    END IF;
    NEW.posted_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payroll_runs_check_posting
  BEFORE UPDATE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION check_payroll_run_posting();

CREATE TRIGGER trg_payroll_runs_audit
  AFTER INSERT OR UPDATE OR DELETE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_payroll_run_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON payroll_run_lines
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

INSERT INTO permissions (module, action, code, description) VALUES
  ('hr', 'post_payroll', 'hr.payroll.post', 'Create and post payroll runs');
