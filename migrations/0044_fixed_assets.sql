-- Phase 9: fixed assets. Straight-line depreciation only (the standard
-- default for a retail business's furniture/fixtures/equipment; no
-- declining-balance or units-of-production support). A depreciation_run is
-- a document like every other in this system: draft -> posted, one GL
-- journal, immutable once posted. One run per fiscal period (mirrors
-- payroll_runs in 0046) — a company runs depreciation once a month, not ad
-- hoc mid-period.
--
-- Journal lines are aggregated per asset_category (not one line per asset)
-- so a company with hundreds of assets still gets a readable journal — the
-- per-asset detail lives in depreciation_run_lines for audit purposes.

CREATE TABLE asset_categories (
  id                                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                            UUID NOT NULL REFERENCES companies(id),
  code                                  TEXT NOT NULL,
  name_en                               TEXT NOT NULL,
  name_ar                               TEXT NOT NULL,
  default_useful_life_months            INTEGER NOT NULL CHECK (default_useful_life_months > 0),
  asset_account_id                      UUID NOT NULL REFERENCES chart_of_accounts(id),
  accumulated_depreciation_account_id   UUID NOT NULL REFERENCES chart_of_accounts(id),
  depreciation_expense_account_id       UUID NOT NULL REFERENCES chart_of_accounts(id),
  is_active                             BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

CREATE INDEX idx_asset_categories_company ON asset_categories(company_id);

CREATE OR REPLACE FUNCTION check_asset_categories_refs_company()
RETURNS TRIGGER AS $$
DECLARE ref_company_id UUID;
BEGIN
  SELECT company_id INTO ref_company_id FROM chart_of_accounts WHERE id = NEW.asset_account_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'asset_account % does not belong to company %', NEW.asset_account_id, NEW.company_id;
  END IF;
  SELECT company_id INTO ref_company_id FROM chart_of_accounts WHERE id = NEW.accumulated_depreciation_account_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'accumulated_depreciation_account % does not belong to company %', NEW.accumulated_depreciation_account_id, NEW.company_id;
  END IF;
  SELECT company_id INTO ref_company_id FROM chart_of_accounts WHERE id = NEW.depreciation_expense_account_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'depreciation_expense_account % does not belong to company %', NEW.depreciation_expense_account_id, NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_asset_categories_check_refs
  BEFORE INSERT OR UPDATE ON asset_categories
  FOR EACH ROW EXECUTE FUNCTION check_asset_categories_refs_company();

CREATE TRIGGER trg_asset_categories_audit
  AFTER INSERT OR UPDATE OR DELETE ON asset_categories
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TABLE fixed_assets (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                UUID NOT NULL REFERENCES companies(id),
  asset_category_id         UUID NOT NULL REFERENCES asset_categories(id),
  store_id                  UUID REFERENCES stores(id),
  asset_code                TEXT NOT NULL,
  name_en                   TEXT NOT NULL,
  name_ar                   TEXT NOT NULL,
  acquisition_date          DATE NOT NULL,
  acquisition_cost          NUMERIC(14,2) NOT NULL CHECK (acquisition_cost > 0),
  salvage_value             NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
  useful_life_months        INTEGER NOT NULL CHECK (useful_life_months > 0), -- snapshot from category at acquisition; can be overridden per-asset
  accumulated_depreciation  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (accumulated_depreciation >= 0), -- trigger-maintained cache, like stock_balances
  status                    TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fully_depreciated', 'disposed')),
  disposed_at               DATE,
  disposal_proceeds         NUMERIC(14,2),
  acquisition_journal_id    UUID REFERENCES journals(id),
  disposal_journal_id       UUID REFERENCES journals(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                UUID REFERENCES users(id),
  UNIQUE (company_id, asset_code),
  CHECK (salvage_value <= acquisition_cost),
  CHECK (accumulated_depreciation <= acquisition_cost - salvage_value)
);

CREATE INDEX idx_fixed_assets_company ON fixed_assets(company_id);
CREATE INDEX idx_fixed_assets_category ON fixed_assets(asset_category_id);

CREATE OR REPLACE FUNCTION check_fixed_assets_refs_company()
RETURNS TRIGGER AS $$
DECLARE ref_company_id UUID;
BEGIN
  SELECT company_id INTO ref_company_id FROM asset_categories WHERE id = NEW.asset_category_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'asset_category % does not belong to company %', NEW.asset_category_id, NEW.company_id;
  END IF;
  IF NEW.store_id IS NOT NULL THEN
    SELECT company_id INTO ref_company_id FROM stores WHERE id = NEW.store_id;
    IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'store % does not belong to company %', NEW.store_id, NEW.company_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fixed_assets_check_refs
  BEFORE INSERT OR UPDATE ON fixed_assets
  FOR EACH ROW EXECUTE FUNCTION check_fixed_assets_refs_company();

-- Once disposed, an asset is permanently frozen (no further depreciation,
-- no un-disposing) — same "posted is final" philosophy as every document
-- table, applied to a master-data-shaped table via its status column.
CREATE OR REPLACE FUNCTION check_fixed_assets_immutable_after_disposal()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'disposed' AND NEW.status = 'disposed' AND NEW.accumulated_depreciation IS DISTINCT FROM OLD.accumulated_depreciation THEN
    RAISE EXCEPTION 'fixed asset % is disposed and cannot be depreciated further', OLD.id;
  END IF;
  IF OLD.status = 'disposed' AND NEW.status <> 'disposed' THEN
    RAISE EXCEPTION 'fixed asset % is disposed and cannot be reactivated', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fixed_assets_immutable_after_disposal
  BEFORE UPDATE ON fixed_assets
  FOR EACH ROW EXECUTE FUNCTION check_fixed_assets_immutable_after_disposal();

CREATE TRIGGER trg_fixed_assets_audit
  AFTER INSERT OR UPDATE OR DELETE ON fixed_assets
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TABLE depreciation_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  fiscal_period_id  UUID NOT NULL REFERENCES fiscal_periods(id),
  document_number   TEXT NOT NULL,
  run_date          DATE NOT NULL,
  document_status   TEXT NOT NULL DEFAULT 'draft' CHECK (document_status IN ('draft', 'posted')),
  posted_at         TIMESTAMPTZ,
  posted_by         UUID REFERENCES users(id),
  journal_id        UUID REFERENCES journals(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES users(id),
  UNIQUE (company_id, document_number),
  UNIQUE (company_id, fiscal_period_id) -- one depreciation run per period
);

CREATE INDEX idx_depreciation_runs_company ON depreciation_runs(company_id);

CREATE TABLE depreciation_run_lines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES companies(id),
  depreciation_run_id   UUID NOT NULL REFERENCES depreciation_runs(id),
  fixed_asset_id        UUID NOT NULL REFERENCES fixed_assets(id),
  depreciation_amount   NUMERIC(14,2) NOT NULL CHECK (depreciation_amount >= 0),
  UNIQUE (depreciation_run_id, fixed_asset_id)
);

CREATE INDEX idx_depreciation_run_lines_run ON depreciation_run_lines(depreciation_run_id);
CREATE INDEX idx_depreciation_run_lines_asset ON depreciation_run_lines(fixed_asset_id);

CREATE OR REPLACE FUNCTION check_depreciation_refs_company()
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

CREATE TRIGGER trg_depreciation_runs_check_refs
  BEFORE INSERT OR UPDATE ON depreciation_runs
  FOR EACH ROW EXECUTE FUNCTION check_depreciation_refs_company();

-- Lines can only be added while the run is draft, same immutability
-- pattern as every other document's line table.
CREATE OR REPLACE FUNCTION check_depreciation_run_line_immutable()
RETURNS TRIGGER AS $$
DECLARE v_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT document_status INTO v_status FROM depreciation_runs WHERE id = COALESCE(NEW.depreciation_run_id, OLD.depreciation_run_id);
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'depreciation run % is posted; its lines are immutable', COALESCE(NEW.depreciation_run_id, OLD.depreciation_run_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_depreciation_run_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON depreciation_run_lines
  FOR EACH ROW EXECUTE FUNCTION check_depreciation_run_line_immutable();

CREATE OR REPLACE FUNCTION check_depreciation_run_posting()
RETURNS TRIGGER AS $$
DECLARE v_journal_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;
  IF OLD.document_status = 'posted' THEN
    RAISE EXCEPTION 'depreciation run % is posted and cannot be modified', OLD.id;
  END IF;
  IF NEW.document_status = 'posted' THEN
    IF NEW.journal_id IS NULL THEN
      RAISE EXCEPTION 'depreciation run % cannot be posted without a GL journal', NEW.id;
    END IF;
    SELECT document_status INTO v_journal_status FROM journals WHERE id = NEW.journal_id;
    IF v_journal_status IS DISTINCT FROM 'posted' THEN
      RAISE EXCEPTION 'depreciation run % journal % must be posted first', NEW.id, NEW.journal_id;
    END IF;
    NEW.posted_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_depreciation_runs_check_posting
  BEFORE UPDATE ON depreciation_runs
  FOR EACH ROW EXECUTE FUNCTION check_depreciation_run_posting();

-- Rolling each line's amount into fixed_assets.accumulated_depreciation
-- (and flipping status to fully_depreciated) happens in application code
-- during postDepreciationRun (src/assets/fixedAssetService.ts), in the same
-- transaction as the journal posting — the same pattern sales invoice
-- posting uses for stock_movements (an explicit service-layer call during
-- posting, not a trigger watching for a future header-status change). A
-- trigger on depreciation_run_lines can't do this correctly: lines are
-- inserted while the run is still 'draft' (draft header+lines first, then
-- journal, then posted header — same order as every other document here),
-- so a trigger keyed off "is the run already posted" would never fire.

CREATE TRIGGER trg_depreciation_runs_audit
  AFTER INSERT OR UPDATE OR DELETE ON depreciation_runs
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_depreciation_run_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON depreciation_run_lines
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

INSERT INTO permissions (module, action, code, description) VALUES
  ('assets', 'manage_fixed_assets', 'assets.fixed_asset.manage', 'Create, acquire, and dispose fixed assets'),
  ('assets', 'post_depreciation', 'assets.depreciation.post', 'Post monthly depreciation runs');
