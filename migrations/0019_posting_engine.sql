-- The one posting engine every subledger routes through (Phase 4+: sales,
-- purchasing, inventory valuation all eventually write a journal + lines
-- here rather than touching account balances directly).
--
-- Posting protocol for callers: within a single transaction,
--   1. INSERT INTO journals (... document_status default 'draft' ...)
--   2. INSERT INTO journal_lines for every line (allowed only while the
--      parent journal is still 'draft')
--   3. UPDATE journals SET document_status = 'posted', posted_by = ...
--      WHERE id = ...
-- Step 3 is what actually enforces balance and period-open — see
-- trg_journals_guard below — so posting cannot be bypassed by skipping a
-- helper function; the invariant lives on the table itself.

CREATE TABLE journals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  journal_number    TEXT NOT NULL,
  journal_date      DATE NOT NULL,
  fiscal_period_id  UUID NOT NULL REFERENCES fiscal_periods(id),
  source_type       TEXT NOT NULL DEFAULT 'manual', -- 'manual', or a future document type e.g. 'pos_invoice'
  source_id         UUID,                            -- id of the source document row, when source_type isn't 'manual'
  memo              TEXT,
  document_status   TEXT NOT NULL DEFAULT 'draft' CHECK (document_status IN ('draft', 'posted')),
  posted_at         TIMESTAMPTZ,
  posted_by         UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES users(id),
  UNIQUE (company_id, journal_number)
);

CREATE INDEX idx_journals_company ON journals(company_id);
CREATE INDEX idx_journals_fiscal_period ON journals(fiscal_period_id);
CREATE INDEX idx_journals_source ON journals(source_type, source_id);

CREATE OR REPLACE FUNCTION check_journal_period_company()
RETURNS TRIGGER AS $$
DECLARE
  v_period_company_id UUID;
BEGIN
  SELECT company_id INTO v_period_company_id FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
  IF v_period_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'fiscal period % does not belong to company %', NEW.fiscal_period_id, NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journals_check_period_company
  BEFORE INSERT OR UPDATE ON journals
  FOR EACH ROW EXECUTE FUNCTION check_journal_period_company();

CREATE TABLE journal_lines (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id), -- denormalized from journals for direct RLS scoping (rule H)
  journal_id     UUID NOT NULL REFERENCES journals(id),
  line_number    INTEGER NOT NULL,
  account_id     UUID NOT NULL REFERENCES chart_of_accounts(id),
  debit_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  description    TEXT,
  UNIQUE (journal_id, line_number),
  CHECK (NOT (debit_amount > 0 AND credit_amount > 0)),
  CHECK (debit_amount > 0 OR credit_amount > 0)
);

CREATE INDEX idx_journal_lines_company ON journal_lines(company_id);
CREATE INDEX idx_journal_lines_journal ON journal_lines(journal_id);
CREATE INDEX idx_journal_lines_account ON journal_lines(account_id);

-- company_id must match the parent journal's, and account_id must be a
-- postable (non-header) leaf in that same company.
CREATE OR REPLACE FUNCTION check_journal_line_account()
RETURNS TRIGGER AS $$
DECLARE
  v_journal_company_id UUID;
  v_account_company_id UUID;
  v_account_is_header BOOLEAN;
BEGIN
  SELECT company_id INTO v_journal_company_id FROM journals WHERE id = NEW.journal_id;

  IF NEW.company_id IS DISTINCT FROM v_journal_company_id THEN
    RAISE EXCEPTION 'journal_line company % does not match journal % company', NEW.company_id, NEW.journal_id;
  END IF;

  SELECT company_id, is_header INTO v_account_company_id, v_account_is_header
    FROM chart_of_accounts WHERE id = NEW.account_id;

  IF v_account_company_id IS DISTINCT FROM v_journal_company_id THEN
    RAISE EXCEPTION 'account % does not belong to the journal''s company', NEW.account_id;
  END IF;

  IF v_account_is_header THEN
    RAISE EXCEPTION 'account % is a header account and cannot be posted to', NEW.account_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_lines_check_account
  BEFORE INSERT OR UPDATE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION check_journal_line_account();

-- Lines are only editable while their parent journal is still 'draft'.
-- This is what makes a posted journal's entries immutable (rule E) and
-- what makes "insert lines, then flip status" a safe two-step protocol
-- inside one transaction: once step 3 succeeds, step 2 can never be
-- repeated or altered for that journal.
CREATE OR REPLACE FUNCTION check_journal_line_immutable()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT document_status INTO v_status FROM journals
    WHERE id = COALESCE(NEW.journal_id, OLD.journal_id);
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'journal % is posted; its lines are immutable', COALESCE(NEW.journal_id, OLD.journal_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION check_journal_line_immutable();

-- The actual posting engine. Not a separate callable function — a trigger,
-- so the invariant holds no matter how document_status gets set to
-- 'posted'. A draft journal is otherwise freely editable (source_type,
-- memo, journal_date, etc.); only the 'posted' transition and any change
-- to an already-posted row are guarded.
CREATE OR REPLACE FUNCTION check_journal_posting()
RETURNS TRIGGER AS $$
DECLARE
  v_period_status period_status;
  v_debit_total NUMERIC(14,2);
  v_credit_total NUMERIC(14,2);
  v_line_count INTEGER;
BEGIN
  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'journal % is posted and cannot be modified', OLD.id;
  END IF;

  IF NEW.document_status = 'posted' THEN
    SELECT status INTO v_period_status FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
    IF v_period_status <> 'open' THEN
      RAISE EXCEPTION 'fiscal period % is closed; cannot post journal %', NEW.fiscal_period_id, NEW.id;
    END IF;

    SELECT COUNT(*), COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
      INTO v_line_count, v_debit_total, v_credit_total
      FROM journal_lines WHERE journal_id = NEW.id;

    IF v_line_count = 0 THEN
      RAISE EXCEPTION 'journal % has no lines and cannot be posted', NEW.id;
    END IF;

    IF v_debit_total <> v_credit_total THEN
      RAISE EXCEPTION 'journal % is not balanced (debits % <> credits %)', NEW.id, v_debit_total, v_credit_total;
    END IF;

    NEW.posted_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journals_guard
  BEFORE UPDATE ON journals
  FOR EACH ROW EXECUTE FUNCTION check_journal_posting();

-- Deleting a posted journal is never allowed; deleting a draft is fine
-- (e.g. abandoning a manual entry before posting).
CREATE OR REPLACE FUNCTION check_journal_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'journal % is posted and cannot be deleted', OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journals_check_delete
  BEFORE DELETE ON journals
  FOR EACH ROW EXECUTE FUNCTION check_journal_delete();

CREATE TRIGGER trg_journals_audit
  AFTER INSERT OR UPDATE OR DELETE ON journals
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_journal_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
