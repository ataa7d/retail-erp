-- A narrow escape hatch for hard-deleting posted journal data: only
-- honored when the session explicitly sets app.bypass_immutability = 'true'
-- (never set by application code — only a dedicated superuser purge script
-- or test cleanup would set it). Real-world equivalent: a GDPR erasure
-- request that must hard-delete even posted records under strict controls.
-- Business rule enforcement is unchanged for every ordinary session.

CREATE OR REPLACE FUNCTION check_journal_line_immutable()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT document_status INTO v_status FROM journals
    WHERE id = COALESCE(NEW.journal_id, OLD.journal_id);
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'journal % is posted; its lines are immutable', COALESCE(NEW.journal_id, OLD.journal_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_journal_posting()
RETURNS TRIGGER AS $$
DECLARE
  v_period_status period_status;
  v_debit_total NUMERIC(14,2);
  v_credit_total NUMERIC(14,2);
  v_line_count INTEGER;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;

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

CREATE OR REPLACE FUNCTION check_journal_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN OLD;
  END IF;

  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'journal % is posted and cannot be deleted', OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
