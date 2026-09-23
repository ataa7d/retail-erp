-- Phase 9: reporting, as real parameterized functions over journal_lines —
-- the same ledger every module already posts through — rather than a
-- separate reporting datastore that could drift from GL truth. A plain
-- VIEW can't take an as_of_date/date-range parameter, so these are
-- table-valued functions (RETURNS TABLE), called like
-- `SELECT * FROM fn_trial_balance($1, $2)`.
--
-- All three only ever look at posted journals — a draft journal (by
-- definition unbalanced-until-posted, per Phase 3) must never appear in a
-- report.

CREATE OR REPLACE FUNCTION fn_trial_balance(p_company_id UUID, p_as_of_date DATE)
RETURNS TABLE(account_code TEXT, name_en TEXT, name_ar TEXT, account_type TEXT, debit_balance NUMERIC, credit_balance NUMERIC)
AS $$
  WITH posted_lines AS (
    SELECT jl.account_id, jl.debit_amount, jl.credit_amount
    FROM journal_lines jl
    JOIN journals j ON j.id = jl.journal_id
    WHERE j.company_id = p_company_id AND j.document_status = 'posted' AND j.journal_date <= p_as_of_date
  )
  SELECT
    coa.account_code, coa.name_en, coa.name_ar, coa.account_type,
    GREATEST(COALESCE(SUM(pl.debit_amount), 0) - COALESCE(SUM(pl.credit_amount), 0), 0)::NUMERIC(14,2) AS debit_balance,
    GREATEST(COALESCE(SUM(pl.credit_amount), 0) - COALESCE(SUM(pl.debit_amount), 0), 0)::NUMERIC(14,2) AS credit_balance
  FROM chart_of_accounts coa
  LEFT JOIN posted_lines pl ON pl.account_id = coa.id
  WHERE coa.company_id = p_company_id AND coa.is_header = false
  GROUP BY coa.id, coa.account_code, coa.name_en, coa.name_ar, coa.account_type
  ORDER BY coa.account_code;
$$ LANGUAGE sql STABLE;

-- Revenue and expense accounts, net movement between two dates. Doesn't
-- assume year-to-date or any particular range — the caller decides what
-- period this income statement covers.
CREATE OR REPLACE FUNCTION fn_income_statement(p_company_id UUID, p_start_date DATE, p_end_date DATE)
RETURNS TABLE(account_code TEXT, name_en TEXT, name_ar TEXT, account_type TEXT, amount NUMERIC)
AS $$
  WITH posted_lines AS (
    SELECT jl.account_id, jl.debit_amount, jl.credit_amount
    FROM journal_lines jl
    JOIN journals j ON j.id = jl.journal_id
    WHERE j.company_id = p_company_id AND j.document_status = 'posted'
      AND j.journal_date BETWEEN p_start_date AND p_end_date
  )
  SELECT
    coa.account_code, coa.name_en, coa.name_ar, coa.account_type,
    (CASE WHEN coa.normal_balance = 'credit'
       THEN COALESCE(SUM(pl.credit_amount), 0) - COALESCE(SUM(pl.debit_amount), 0)
       ELSE COALESCE(SUM(pl.debit_amount), 0) - COALESCE(SUM(pl.credit_amount), 0)
     END)::NUMERIC(14,2) AS amount
  FROM chart_of_accounts coa
  LEFT JOIN posted_lines pl ON pl.account_id = coa.id
  WHERE coa.company_id = p_company_id AND coa.is_header = false AND coa.account_type IN ('revenue', 'expense')
  GROUP BY coa.id, coa.account_code, coa.name_en, coa.name_ar, coa.account_type, coa.normal_balance
  ORDER BY coa.account_type, coa.account_code;
$$ LANGUAGE sql STABLE;

-- Asset/liability/equity balances as of a date, PLUS a synthetic
-- 'CURRENT_EARNINGS' equity row for the still-open fiscal year's net
-- income. Without this, the balance sheet would only balance right after
-- closeFiscalYear runs (Phase 7) — revenue/expense accounts sit unclosed
-- all year, so assets = liabilities + equity would otherwise be off by
-- exactly the year's net income for every date except the last.
CREATE OR REPLACE FUNCTION fn_balance_sheet(p_company_id UUID, p_as_of_date DATE)
RETURNS TABLE(account_code TEXT, name_en TEXT, name_ar TEXT, account_type TEXT, balance NUMERIC)
AS $$
DECLARE
  v_fy_start DATE;
  v_fy_end DATE;
  v_net_income NUMERIC(14,2);
BEGIN
  SELECT start_date, end_date INTO v_fy_start, v_fy_end
  FROM fiscal_years
  WHERE company_id = p_company_id AND start_date <= p_as_of_date AND end_date >= p_as_of_date
  LIMIT 1;

  RETURN QUERY
  WITH posted_lines AS (
    SELECT jl.account_id, jl.debit_amount, jl.credit_amount
    FROM journal_lines jl
    JOIN journals j ON j.id = jl.journal_id
    WHERE j.company_id = p_company_id AND j.document_status = 'posted' AND j.journal_date <= p_as_of_date
  )
  SELECT
    coa.account_code, coa.name_en, coa.name_ar, coa.account_type,
    (CASE WHEN coa.normal_balance = 'debit'
       THEN COALESCE(SUM(pl.debit_amount), 0) - COALESCE(SUM(pl.credit_amount), 0)
       ELSE COALESCE(SUM(pl.credit_amount), 0) - COALESCE(SUM(pl.debit_amount), 0)
     END)::NUMERIC(14,2) AS balance
  FROM chart_of_accounts coa
  LEFT JOIN posted_lines pl ON pl.account_id = coa.id
  WHERE coa.company_id = p_company_id AND coa.is_header = false AND coa.account_type IN ('asset', 'liability', 'equity')
  GROUP BY coa.id, coa.account_code, coa.name_en, coa.name_ar, coa.account_type, coa.normal_balance
  ORDER BY coa.account_type, coa.account_code;

  IF v_fy_start IS NOT NULL THEN
    SELECT COALESCE(SUM(COALESCE(jl.credit_amount, 0) - COALESCE(jl.debit_amount, 0)), 0)
      INTO v_net_income
      FROM journal_lines jl
      JOIN journals j ON j.id = jl.journal_id
      JOIN chart_of_accounts coa ON coa.id = jl.account_id
      WHERE j.company_id = p_company_id AND j.document_status = 'posted'
        AND j.journal_date BETWEEN v_fy_start AND LEAST(v_fy_end, p_as_of_date)
        AND coa.account_type IN ('revenue', 'expense');

    RETURN QUERY SELECT
      'CURRENT_EARNINGS'::TEXT, 'Current Year Earnings'::TEXT, 'أرباح السنة الحالية'::TEXT, 'equity'::TEXT, v_net_income;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

INSERT INTO permissions (module, action, code, description) VALUES
  ('accounting', 'view_reports', 'accounting.reports.view', 'View trial balance, income statement, and balance sheet');
