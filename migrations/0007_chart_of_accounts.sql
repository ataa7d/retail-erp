-- Multi-level chart of accounts per company. is_header distinguishes a
-- group/subtotal node (e.g. "Current Assets") from a postable leaf account
-- — the posting engine (Phase 3) will reject any journal line against a
-- header account. normal_balance drives how debit/credit presentation and
-- trial-balance signs work without re-deriving it from account_type at
-- report time.

CREATE TYPE account_type AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');
CREATE TYPE normal_balance_side AS ENUM ('debit', 'credit');

CREATE TABLE chart_of_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id),
  parent_id       UUID REFERENCES chart_of_accounts(id),
  account_code    TEXT NOT NULL,
  name_en         TEXT NOT NULL,
  name_ar         TEXT NOT NULL,
  account_type    account_type NOT NULL,
  normal_balance  normal_balance_side NOT NULL,
  is_header       BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, account_code)
);

CREATE TRIGGER trg_chart_of_accounts_updated_at
  BEFORE UPDATE ON chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_coa_company ON chart_of_accounts(company_id);
CREATE INDEX idx_coa_parent ON chart_of_accounts(parent_id);

-- A parent account must belong to the same company as its child.
CREATE OR REPLACE FUNCTION check_coa_parent_company()
RETURNS TRIGGER AS $$
DECLARE
  parent_company_id UUID;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT company_id INTO parent_company_id FROM chart_of_accounts WHERE id = NEW.parent_id;
    IF parent_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'parent account % does not belong to company %', NEW.parent_id, NEW.company_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_coa_check_parent_company
  BEFORE INSERT OR UPDATE ON chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION check_coa_parent_company();
