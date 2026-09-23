-- customers.vat_registration_number/cr_number/address matter for ZATCA:
-- standard (B2B) tax invoices must carry the buyer's VAT number, legal
-- name, and address. Simplified (B2C/POS) invoices don't need any of it,
-- so all of it is nullable — POS walk-in customers just won't have it.

CREATE TYPE customer_type AS ENUM ('retail', 'wholesale', 'credit');

CREATE TABLE customers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               UUID NOT NULL REFERENCES companies(id),
  customer_code            TEXT NOT NULL,
  name_en                  TEXT NOT NULL,
  name_ar                  TEXT NOT NULL,
  customer_type            customer_type NOT NULL DEFAULT 'retail',
  cr_number                TEXT,
  vat_registration_number  TEXT,
  address                  TEXT,
  city                     TEXT,
  phone                    TEXT,
  email                    CITEXT,
  credit_limit             NUMERIC(14,2) CHECK (credit_limit IS NULL OR credit_limit >= 0),
  payment_terms_days       INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  is_loyalty_member        BOOLEAN NOT NULL DEFAULT false,
  loyalty_card_number      TEXT,
  is_active                BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, customer_code)
);

CREATE UNIQUE INDEX idx_customers_loyalty_card
  ON customers(company_id, loyalty_card_number) WHERE loyalty_card_number IS NOT NULL;

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_customers_company ON customers(company_id);

CREATE TABLE suppliers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               UUID NOT NULL REFERENCES companies(id),
  supplier_code            TEXT NOT NULL,
  name_en                  TEXT NOT NULL,
  name_ar                  TEXT NOT NULL,
  cr_number                TEXT,
  vat_registration_number  TEXT,
  address                  TEXT,
  city                     TEXT,
  country                  TEXT,
  phone                    TEXT,
  email                    CITEXT,
  payment_terms_days       INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  lead_time_days           INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  is_active                BOOLEAN NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, supplier_code)
);

CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_suppliers_company ON suppliers(company_id);
