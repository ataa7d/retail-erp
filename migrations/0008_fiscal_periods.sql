-- Fiscal years and periods per company. status drives the Phase 3 posting
-- engine's "closed periods reject posting" rule — checked there, not here,
-- since posting doesn't exist yet, but the status column has to exist now
-- for that check to be possible.

CREATE TYPE period_status AS ENUM ('open', 'closed');

CREATE TABLE fiscal_years (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  year_name   TEXT NOT NULL,        -- e.g. 'FY2026'
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  status      period_status NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, year_name),
  CHECK (end_date > start_date)
);

CREATE TRIGGER trg_fiscal_years_updated_at
  BEFORE UPDATE ON fiscal_years
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_fiscal_years_company ON fiscal_years(company_id);

CREATE TABLE fiscal_periods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year_id  UUID NOT NULL REFERENCES fiscal_years(id),
  company_id      UUID NOT NULL REFERENCES companies(id),
  period_number   INTEGER NOT NULL CHECK (period_number BETWEEN 1 AND 12),
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  status          period_status NOT NULL DEFAULT 'open',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (fiscal_year_id, period_number),
  CHECK (end_date > start_date)
);

CREATE TRIGGER trg_fiscal_periods_updated_at
  BEFORE UPDATE ON fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_fiscal_periods_company ON fiscal_periods(company_id);
CREATE INDEX idx_fiscal_periods_year ON fiscal_periods(fiscal_year_id);

-- A period's company must match its fiscal year's company, and its dates
-- must fall within the fiscal year's range.
CREATE OR REPLACE FUNCTION check_fiscal_period_scope()
RETURNS TRIGGER AS $$
DECLARE
  v_year_company_id UUID;
  v_year_start DATE;
  v_year_end DATE;
BEGIN
  SELECT company_id, start_date, end_date
    INTO v_year_company_id, v_year_start, v_year_end
    FROM fiscal_years WHERE id = NEW.fiscal_year_id;

  IF v_year_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'fiscal year % does not belong to company %', NEW.fiscal_year_id, NEW.company_id;
  END IF;

  IF NEW.start_date < v_year_start OR NEW.end_date > v_year_end THEN
    RAISE EXCEPTION 'period % dates fall outside fiscal year % range', NEW.period_number, NEW.fiscal_year_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fiscal_periods_check_scope
  BEFORE INSERT OR UPDATE ON fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION check_fiscal_period_scope();
