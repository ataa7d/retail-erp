-- Budget vs actual: a genuine, previously entirely-absent gap -- no
-- budget concept existed anywhere in the schema. Scoped to P&L accounts
-- only (revenue/expense), matching fn_income_statement's own scope --
-- budgeting a balance sheet is a different, much less common exercise for
-- a retail business and out of scope here.

CREATE TABLE budgets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id),
  fiscal_year_id  UUID NOT NULL REFERENCES fiscal_years(id),
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES users(id),
  UNIQUE (company_id, fiscal_year_id, name)
);

CREATE INDEX idx_budgets_company ON budgets(company_id);

CREATE TABLE budget_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  budget_id         UUID NOT NULL REFERENCES budgets(id),
  fiscal_period_id  UUID NOT NULL REFERENCES fiscal_periods(id),
  account_id        UUID NOT NULL REFERENCES chart_of_accounts(id),
  amount            NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (budget_id, fiscal_period_id, account_id)
);

CREATE INDEX idx_budget_lines_company ON budget_lines(company_id);
CREATE INDEX idx_budget_lines_budget ON budget_lines(budget_id);

CREATE OR REPLACE FUNCTION check_budget_refs_company()
RETURNS TRIGGER AS $$
DECLARE
  ref_company_id UUID;
BEGIN
  SELECT company_id INTO ref_company_id FROM fiscal_years WHERE id = NEW.fiscal_year_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'fiscal year % does not belong to company %', NEW.fiscal_year_id, NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_budgets_check_refs
  BEFORE INSERT OR UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION check_budget_refs_company();

CREATE OR REPLACE FUNCTION check_budget_line_refs()
RETURNS TRIGGER AS $$
DECLARE
  v_budget_company_id UUID;
  v_budget_fiscal_year_id UUID;
  v_period_company_id UUID;
  v_period_fiscal_year_id UUID;
  v_account_company_id UUID;
  v_account_is_header BOOLEAN;
  v_account_type account_type;
BEGIN
  SELECT company_id, fiscal_year_id INTO v_budget_company_id, v_budget_fiscal_year_id FROM budgets WHERE id = NEW.budget_id;
  IF NEW.company_id IS DISTINCT FROM v_budget_company_id THEN
    RAISE EXCEPTION 'line company % does not match budget % company', NEW.company_id, NEW.budget_id;
  END IF;

  SELECT company_id, fiscal_year_id INTO v_period_company_id, v_period_fiscal_year_id FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
  IF v_period_company_id IS DISTINCT FROM NEW.company_id OR v_period_fiscal_year_id IS DISTINCT FROM v_budget_fiscal_year_id THEN
    RAISE EXCEPTION 'fiscal period % does not belong to budget %''s fiscal year', NEW.fiscal_period_id, NEW.budget_id;
  END IF;

  SELECT company_id, is_header, account_type INTO v_account_company_id, v_account_is_header, v_account_type
    FROM chart_of_accounts WHERE id = NEW.account_id;
  IF v_account_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'account % does not belong to company %', NEW.account_id, NEW.company_id;
  END IF;
  IF v_account_is_header THEN
    RAISE EXCEPTION 'account % is a header account and cannot carry a budget line', NEW.account_id;
  END IF;
  IF v_account_type NOT IN ('revenue', 'expense') THEN
    RAISE EXCEPTION 'account % is a % account; budgets only cover revenue/expense accounts', NEW.account_id, v_account_type;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_budget_lines_check_refs
  BEFORE INSERT OR UPDATE ON budget_lines
  FOR EACH ROW EXECUTE FUNCTION check_budget_line_refs();

CREATE TRIGGER trg_budgets_audit
  AFTER INSERT OR UPDATE OR DELETE ON budgets
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_budget_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON budget_lines
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

-- Same actual-amount computation as fn_income_statement (0048). Scoped to
-- one specific budget (multiple named budgets -- revisions, scenarios --
-- can exist per fiscal year, so "budget vs actual" always means one
-- chosen budget's lines vs actual, never an ambiguous sum across
-- whichever budgets happen to exist). An account only appears if it has
-- a budget line, actual activity, or both.
CREATE OR REPLACE FUNCTION fn_budget_vs_actual(p_company_id UUID, p_budget_id UUID, p_start_date DATE, p_end_date DATE)
RETURNS TABLE(account_code TEXT, name_en TEXT, name_ar TEXT, account_type TEXT, budget_amount NUMERIC, actual_amount NUMERIC, variance NUMERIC)
AS $$
  WITH posted_lines AS (
    SELECT jl.account_id, jl.debit_amount, jl.credit_amount
    FROM journal_lines jl
    JOIN journals j ON j.id = jl.journal_id
    WHERE j.company_id = p_company_id AND j.document_status = 'posted'
      AND j.journal_date BETWEEN p_start_date AND p_end_date
  ),
  budgeted AS (
    SELECT bl.account_id, SUM(bl.amount) AS budget_amount
    FROM budget_lines bl
    JOIN budgets b ON b.id = bl.budget_id
    JOIN fiscal_periods fp ON fp.id = bl.fiscal_period_id
    WHERE b.company_id = p_company_id AND bl.budget_id = p_budget_id
      AND fp.start_date <= p_end_date AND fp.end_date >= p_start_date
    GROUP BY bl.account_id
  ),
  actuals AS (
    SELECT
      coa.id AS account_id, coa.account_code, coa.name_en, coa.name_ar, coa.account_type::TEXT AS account_type,
      (CASE WHEN coa.normal_balance = 'credit'
         THEN COALESCE(SUM(pl.credit_amount), 0) - COALESCE(SUM(pl.debit_amount), 0)
         ELSE COALESCE(SUM(pl.debit_amount), 0) - COALESCE(SUM(pl.credit_amount), 0)
       END)::NUMERIC(14,2) AS actual_amount
    FROM chart_of_accounts coa
    LEFT JOIN posted_lines pl ON pl.account_id = coa.id
    WHERE coa.company_id = p_company_id AND coa.is_header = false AND coa.account_type IN ('revenue', 'expense')
    GROUP BY coa.id, coa.account_code, coa.name_en, coa.name_ar, coa.account_type, coa.normal_balance
  )
  SELECT
    a.account_code, a.name_en, a.name_ar, a.account_type,
    COALESCE(bud.budget_amount, 0)::NUMERIC(14,2) AS budget_amount,
    a.actual_amount,
    (a.actual_amount - COALESCE(bud.budget_amount, 0))::NUMERIC(14,2) AS variance
  FROM actuals a
  LEFT JOIN budgeted bud ON bud.account_id = a.account_id
  WHERE a.actual_amount <> 0 OR bud.budget_amount IS NOT NULL
  ORDER BY a.account_type, a.account_code;
$$ LANGUAGE sql STABLE;

INSERT INTO permissions (module, action, code, description) VALUES
  ('accounting', 'manage_budget', 'accounting.budget.manage', 'Create budgets and set budget line amounts');
