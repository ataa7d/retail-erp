-- Branch: a legal/regional entity under a company. Can carry its own CR/VAT
-- registration (falls back to the company's if null) — some groups register
-- VAT per establishment with ZATCA, others register once for the whole company.
--
-- Store: a physical selling point under a branch (shop floor, kiosk,
-- warehouse). Multiple stores can share one branch's VAT registration.
-- company_id is duplicated onto both tables (not just derivable via join)
-- because every transactional/scoped table is queried and RLS-filtered by
-- company_id directly — see rule H.

CREATE TABLE branches (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               UUID NOT NULL REFERENCES companies(id),
  branch_code              TEXT NOT NULL,
  name_en                  TEXT NOT NULL,
  name_ar                  TEXT NOT NULL,
  cr_number                TEXT,
  vat_registration_number  TEXT,
  address                  TEXT,
  city                     TEXT,
  is_active                BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, branch_code)
);

CREATE TRIGGER trg_branches_updated_at
  BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_branches_company ON branches(company_id);

CREATE TYPE store_type AS ENUM ('retail', 'warehouse', 'kiosk', 'online');

CREATE TABLE stores (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id),
  branch_id     UUID NOT NULL REFERENCES branches(id),
  store_code    TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  name_ar       TEXT NOT NULL,
  store_type    store_type NOT NULL DEFAULT 'retail',
  address       TEXT,
  city          TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, store_code)
);

CREATE TRIGGER trg_stores_updated_at
  BEFORE UPDATE ON stores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_stores_company ON stores(company_id);
CREATE INDEX idx_stores_branch ON stores(branch_id);
