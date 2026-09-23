-- Phase 9: HR master data. Deliberately scoped down — employee records and
-- their salary components, no attendance/leave/appraisal tracking. This is
-- what payroll (0046) needs and nothing more.

CREATE TABLE departments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  code        TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  name_ar     TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

CREATE INDEX idx_departments_company ON departments(company_id);

CREATE TABLE positions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  code        TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  name_ar     TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

CREATE INDEX idx_positions_company ON positions(company_id);

CREATE TABLE employees (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES companies(id),
  department_id         UUID REFERENCES departments(id),
  position_id           UUID REFERENCES positions(id),
  store_id              UUID REFERENCES stores(id),
  employee_code         TEXT NOT NULL,
  full_name_en          TEXT NOT NULL,
  full_name_ar          TEXT NOT NULL,
  national_id            TEXT, -- national ID (citizens) or iqama number (residents) — one field, not two, since a person has exactly one at a time
  nationality            TEXT,
  hire_date             DATE NOT NULL,
  termination_date      DATE,
  basic_salary          NUMERIC(14,2) NOT NULL CHECK (basic_salary >= 0),
  housing_allowance     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (housing_allowance >= 0),
  other_allowances      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (other_allowances >= 0),
  -- GOSI rates stored per-employee, not hardcoded — they vary by whether
  -- the employee is Saudi (employee + employer contribute) or a
  -- non-Saudi/GCC national (employer-only, via a different scheme), and
  -- Saudi rates have changed over time, so a company-wide constant would
  -- be wrong sooner or later.
  gosi_employee_rate    NUMERIC(5,2) NOT NULL DEFAULT 9.75 CHECK (gosi_employee_rate >= 0),
  gosi_employer_rate    NUMERIC(5,2) NOT NULL DEFAULT 11.75 CHECK (gosi_employer_rate >= 0),
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'terminated')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID REFERENCES users(id),
  UNIQUE (company_id, employee_code),
  CHECK (termination_date IS NULL OR termination_date >= hire_date)
);

CREATE INDEX idx_employees_company ON employees(company_id);
CREATE INDEX idx_employees_department ON employees(department_id);

CREATE OR REPLACE FUNCTION check_employees_refs_company()
RETURNS TRIGGER AS $$
DECLARE ref_company_id UUID;
BEGIN
  IF NEW.department_id IS NOT NULL THEN
    SELECT company_id INTO ref_company_id FROM departments WHERE id = NEW.department_id;
    IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'department % does not belong to company %', NEW.department_id, NEW.company_id;
    END IF;
  END IF;
  IF NEW.position_id IS NOT NULL THEN
    SELECT company_id INTO ref_company_id FROM positions WHERE id = NEW.position_id;
    IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'position % does not belong to company %', NEW.position_id, NEW.company_id;
    END IF;
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

CREATE TRIGGER trg_employees_check_refs
  BEFORE INSERT OR UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION check_employees_refs_company();

CREATE TRIGGER trg_departments_audit
  AFTER INSERT OR UPDATE OR DELETE ON departments
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_positions_audit
  AFTER INSERT OR UPDATE OR DELETE ON positions
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_employees_audit
  AFTER INSERT OR UPDATE OR DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

INSERT INTO permissions (module, action, code, description) VALUES
  ('hr', 'manage_employees', 'hr.employee.manage', 'Create and edit employee records, departments, and positions');
