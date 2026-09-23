-- Each bank account maps to its own GL leaf account — sharing one generic
-- "Cash & Equivalents" account across multiple physical bank accounts
-- would make reconciliation meaningless (you couldn't tell which
-- statement matches which GL balance).

CREATE TABLE bank_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  gl_account_id     UUID NOT NULL REFERENCES chart_of_accounts(id),
  bank_name         TEXT NOT NULL,
  account_name      TEXT NOT NULL,
  account_number    TEXT,
  iban              TEXT,
  currency          TEXT NOT NULL DEFAULT 'SAR',
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gl_account_id)
);

CREATE TRIGGER trg_bank_accounts_updated_at
  BEFORE UPDATE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_bank_accounts_company ON bank_accounts(company_id);

CREATE OR REPLACE FUNCTION check_bank_account_gl_company()
RETURNS TRIGGER AS $$
DECLARE
  v_gl_company_id UUID;
  v_gl_is_header BOOLEAN;
BEGIN
  SELECT company_id, is_header INTO v_gl_company_id, v_gl_is_header FROM chart_of_accounts WHERE id = NEW.gl_account_id;
  IF v_gl_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'GL account % does not belong to company %', NEW.gl_account_id, NEW.company_id;
  END IF;
  IF v_gl_is_header THEN
    RAISE EXCEPTION 'GL account % is a header account and cannot back a bank account', NEW.gl_account_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bank_accounts_check_gl_company
  BEFORE INSERT OR UPDATE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION check_bank_account_gl_company();

CREATE TRIGGER trg_bank_accounts_audit
  AFTER INSERT OR UPDATE OR DELETE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
