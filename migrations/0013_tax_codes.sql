-- Tax code catalog: defaulting/UI only. A document line's own vat_rate
-- (introduced in Phase 3) is always a frozen persisted number copied at
-- transaction time, never re-derived from this table at read time — see
-- rule A. tax_type distinguishes zero-rated exports from VAT-exempt items,
-- which behave differently for ZATCA reporting even though both show 0.00
-- on the invoice.

CREATE TYPE tax_type AS ENUM ('standard', 'zero_rated', 'exempt');

CREATE TABLE tax_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  code        TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  name_ar     TEXT NOT NULL,
  rate        NUMERIC(5,2) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  tax_type    tax_type NOT NULL DEFAULT 'standard',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  CHECK (tax_type = 'standard' OR rate = 0)
);

CREATE TRIGGER trg_tax_codes_updated_at
  BEFORE UPDATE ON tax_codes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_tax_codes_company ON tax_codes(company_id);
