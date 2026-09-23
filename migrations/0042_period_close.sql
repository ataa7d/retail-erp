-- Period close is mostly already enforced: check_journal_posting (Phase 3)
-- already rejects posting into a closed period. What's added here: who/
-- when closed it, sequential closing (can't close March before February),
-- and a guard against closing a period that still has draft journals
-- dated in it (those would become permanently unpostable otherwise,
-- without the user having a chance to notice and act).

ALTER TABLE fiscal_periods ADD COLUMN closed_at TIMESTAMPTZ;
ALTER TABLE fiscal_periods ADD COLUMN closed_by UUID REFERENCES users(id);

ALTER TABLE fiscal_years ADD COLUMN closed_at TIMESTAMPTZ;
ALTER TABLE fiscal_years ADD COLUMN closed_by UUID REFERENCES users(id);

CREATE OR REPLACE FUNCTION check_fiscal_period_close()
RETURNS TRIGGER AS $$
DECLARE
  v_earlier_open_count INTEGER;
  v_draft_journal_count INTEGER;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'closed' AND OLD.status = 'open' THEN
    SELECT COUNT(*) INTO v_earlier_open_count
      FROM fiscal_periods
      WHERE fiscal_year_id = NEW.fiscal_year_id
        AND period_number < NEW.period_number
        AND status = 'open';
    IF v_earlier_open_count > 0 THEN
      RAISE EXCEPTION 'cannot close period % while an earlier period in the same fiscal year is still open', NEW.id;
    END IF;

    SELECT COUNT(*) INTO v_draft_journal_count FROM journals WHERE fiscal_period_id = NEW.id AND document_status = 'draft';
    IF v_draft_journal_count > 0 THEN
      RAISE EXCEPTION 'cannot close period %: % draft journal(s) still dated in it', NEW.id, v_draft_journal_count;
    END IF;

    NEW.closed_at := now();
  ELSIF NEW.status = 'open' AND OLD.status = 'closed' THEN
    -- Reopening is allowed (e.g. correcting a premature close) but only
    -- the most recently closed period in its fiscal year, to preserve
    -- sequential integrity.
    IF EXISTS (
      SELECT 1 FROM fiscal_periods
      WHERE fiscal_year_id = NEW.fiscal_year_id AND period_number > NEW.period_number AND status = 'closed'
    ) THEN
      RAISE EXCEPTION 'cannot reopen period %: a later period in the same fiscal year is still closed', NEW.id;
    END IF;
    NEW.closed_at := NULL;
    NEW.closed_by := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fiscal_periods_check_close
  BEFORE UPDATE ON fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION check_fiscal_period_close();

CREATE OR REPLACE FUNCTION check_fiscal_year_close()
RETURNS TRIGGER AS $$
DECLARE
  v_open_period_count INTEGER;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'closed' AND OLD.status = 'open' THEN
    SELECT COUNT(*) INTO v_open_period_count FROM fiscal_periods WHERE fiscal_year_id = NEW.id AND status = 'open';
    IF v_open_period_count > 0 THEN
      RAISE EXCEPTION 'cannot close fiscal year %: % period(s) still open', NEW.id, v_open_period_count;
    END IF;
    NEW.closed_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fiscal_years_check_close
  BEFORE UPDATE ON fiscal_years
  FOR EACH ROW EXECUTE FUNCTION check_fiscal_year_close();
