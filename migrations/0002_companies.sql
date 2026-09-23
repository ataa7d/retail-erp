-- Companies: the tenant root. Every transactional table elsewhere carries company_id.

CREATE TABLE companies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_code        TEXT NOT NULL UNIQUE,
  name_en             TEXT NOT NULL,
  name_ar             TEXT NOT NULL,
  cr_number            TEXT,            -- Commercial Registration number
  vat_registration_number TEXT,          -- ZATCA VAT number (15 digits)
  base_currency       TEXT NOT NULL DEFAULT 'SAR',
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
