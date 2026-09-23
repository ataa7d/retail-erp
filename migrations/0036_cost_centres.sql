-- Cost centres are a tag on journal lines, not a parallel posting engine —
-- every journal line optionally carries one for later cost-centre-level
-- reporting, with no change to how posting/balancing works.

CREATE TABLE cost_centres (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  parent_id   UUID REFERENCES cost_centres(id),
  code        TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  name_ar     TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TRIGGER trg_cost_centres_updated_at
  BEFORE UPDATE ON cost_centres
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_cost_centres_company ON cost_centres(company_id);
CREATE INDEX idx_cost_centres_parent ON cost_centres(parent_id);

CREATE OR REPLACE FUNCTION check_cost_centre_parent_company()
RETURNS TRIGGER AS $$
DECLARE
  parent_company_id UUID;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT company_id INTO parent_company_id FROM cost_centres WHERE id = NEW.parent_id;
    IF parent_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'parent cost centre % does not belong to company %', NEW.parent_id, NEW.company_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cost_centres_check_parent_company
  BEFORE INSERT OR UPDATE ON cost_centres
  FOR EACH ROW EXECUTE FUNCTION check_cost_centre_parent_company();

CREATE TRIGGER trg_cost_centres_audit
  AFTER INSERT OR UPDATE OR DELETE ON cost_centres
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

ALTER TABLE journal_lines ADD COLUMN cost_center_id UUID REFERENCES cost_centres(id);
CREATE INDEX idx_journal_lines_cost_center ON journal_lines(cost_center_id);

CREATE OR REPLACE FUNCTION check_journal_line_cost_centre_company()
RETURNS TRIGGER AS $$
DECLARE
  v_cost_centre_company_id UUID;
BEGIN
  IF NEW.cost_center_id IS NOT NULL THEN
    SELECT company_id INTO v_cost_centre_company_id FROM cost_centres WHERE id = NEW.cost_center_id;
    IF v_cost_centre_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'cost centre % does not belong to company %', NEW.cost_center_id, NEW.company_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_lines_check_cost_centre
  BEFORE INSERT OR UPDATE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION check_journal_line_cost_centre_company();
