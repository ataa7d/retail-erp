-- Bank reconciliation: statement lines get matched against a specific GL
-- journal_line on the bank's own account, then swept into a
-- bank_reconciliation when confirmed. Simplification (documented, not
-- hidden): posting a reconciliation validates that the running total of
-- every statement line ever reconciled for this bank account, up to and
-- including the statement date, equals the declared ending balance — full
-- outstanding-items reconciliation theory (deposits in transit, etc.) is
-- not modeled.

CREATE TABLE bank_reconciliations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES companies(id),
  bank_account_id         UUID NOT NULL REFERENCES bank_accounts(id),
  statement_date          DATE NOT NULL,
  statement_ending_balance NUMERIC(14,2) NOT NULL,
  document_status         TEXT NOT NULL DEFAULT 'draft' CHECK (document_status IN ('draft', 'posted')),
  posted_at               TIMESTAMPTZ,
  posted_by               UUID REFERENCES users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              UUID REFERENCES users(id)
);

CREATE INDEX idx_bank_reconciliations_company ON bank_reconciliations(company_id);
CREATE INDEX idx_bank_reconciliations_bank_account ON bank_reconciliations(bank_account_id);

CREATE TABLE bank_statement_lines (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES companies(id),
  bank_account_id         UUID NOT NULL REFERENCES bank_accounts(id),
  statement_date          DATE NOT NULL,
  description             TEXT,
  amount                  NUMERIC(14,2) NOT NULL CHECK (amount <> 0), -- signed: positive = deposit, negative = withdrawal
  reference                TEXT,
  matched_journal_line_id  UUID REFERENCES journal_lines(id),
  bank_reconciliation_id   UUID REFERENCES bank_reconciliations(id), -- set once swept into a posted reconciliation
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                UUID REFERENCES users(id),
  UNIQUE (matched_journal_line_id)
);

CREATE INDEX idx_bank_statement_lines_bank_account ON bank_statement_lines(bank_account_id);
CREATE INDEX idx_bank_statement_lines_reconciliation ON bank_statement_lines(bank_reconciliation_id);

CREATE OR REPLACE FUNCTION check_bank_reconciliation_company()
RETURNS TRIGGER AS $$
DECLARE
  ref_company_id UUID;
BEGIN
  SELECT company_id INTO ref_company_id FROM bank_accounts WHERE id = NEW.bank_account_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'bank account % does not belong to company %', NEW.bank_account_id, NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bank_reconciliations_check_company
  BEFORE INSERT OR UPDATE ON bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION check_bank_reconciliation_company();

CREATE OR REPLACE FUNCTION check_bank_statement_line_refs()
RETURNS TRIGGER AS $$
DECLARE
  v_bank_account_company_id UUID;
  v_journal_line_account_id UUID;
  v_bank_gl_account_id UUID;
BEGIN
  SELECT company_id, gl_account_id INTO v_bank_account_company_id, v_bank_gl_account_id
    FROM bank_accounts WHERE id = NEW.bank_account_id;
  IF v_bank_account_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'bank account % does not belong to company %', NEW.bank_account_id, NEW.company_id;
  END IF;

  IF NEW.matched_journal_line_id IS NOT NULL THEN
    SELECT account_id INTO v_journal_line_account_id FROM journal_lines WHERE id = NEW.matched_journal_line_id;
    IF v_journal_line_account_id IS DISTINCT FROM v_bank_gl_account_id THEN
      RAISE EXCEPTION 'journal line % does not post to this bank account''s GL account', NEW.matched_journal_line_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bank_statement_lines_check_refs
  BEFORE INSERT OR UPDATE ON bank_statement_lines
  FOR EACH ROW EXECUTE FUNCTION check_bank_statement_line_refs();

-- Once swept into a bank_reconciliation, a statement line's match is
-- locked (same immutability pattern as everywhere else).
CREATE OR REPLACE FUNCTION check_bank_statement_line_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF OLD.bank_reconciliation_id IS NOT NULL THEN
    RAISE EXCEPTION 'statement line % is already reconciled and cannot be modified', OLD.id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bank_statement_lines_immutable
  BEFORE UPDATE OR DELETE ON bank_statement_lines
  FOR EACH ROW EXECUTE FUNCTION check_bank_statement_line_immutable();

CREATE OR REPLACE FUNCTION check_bank_reconciliation_posting()
RETURNS TRIGGER AS $$
DECLARE
  v_running_total NUMERIC(14,2);
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'bank reconciliation % is posted and cannot be modified', OLD.id;
  END IF;

  IF NEW.document_status = 'posted' THEN
    IF NOT EXISTS (SELECT 1 FROM bank_statement_lines WHERE bank_reconciliation_id = NEW.id) THEN
      RAISE EXCEPTION 'bank reconciliation % has no matched statement lines', NEW.id;
    END IF;

    SELECT COALESCE(SUM(bsl.amount), 0) INTO v_running_total
      FROM bank_statement_lines bsl
      JOIN bank_reconciliations br ON br.id = bsl.bank_reconciliation_id
      WHERE bsl.bank_account_id = NEW.bank_account_id
        AND bsl.statement_date <= NEW.statement_date
        AND (br.document_status = 'posted' OR br.id = NEW.id);

    IF v_running_total <> NEW.statement_ending_balance THEN
      RAISE EXCEPTION 'reconciled running total % does not match declared ending balance % for reconciliation %',
        v_running_total, NEW.statement_ending_balance, NEW.id;
    END IF;

    NEW.posted_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bank_reconciliations_check_posting
  BEFORE UPDATE ON bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION check_bank_reconciliation_posting();

CREATE TRIGGER trg_bank_reconciliations_audit
  AFTER INSERT OR UPDATE OR DELETE ON bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_bank_statement_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON bank_statement_lines
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
