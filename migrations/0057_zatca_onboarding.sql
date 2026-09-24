-- ZATCA Phase 2 sandbox onboarding: the credential lifecycle for one
-- company's EGS (E-invoice Generation Solution) unit. One row per company
-- -- a real multi-branch deployment might need one EGS unit per branch,
-- but this keeps the same "company is the compliance root" model already
-- used for VAT registration elsewhere in this schema.
--
-- private_key_pem, compliance_secret and production_secret are encrypted
-- at rest by the application (see src/zatca/credentialCrypto.ts) before
-- ever reaching this table -- never store them in plaintext.

CREATE TYPE zatca_onboarding_status AS ENUM (
  'not_started',
  'csr_generated',
  'compliance_csid_issued',
  'compliance_checks_passed',
  'production_csid_issued',
  'failed'
);

CREATE TYPE zatca_environment AS ENUM ('sandbox', 'simulation', 'production');

CREATE TABLE zatca_onboarding (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               UUID NOT NULL UNIQUE REFERENCES companies(id),
  environment              zatca_environment NOT NULL DEFAULT 'sandbox',
  status                   zatca_onboarding_status NOT NULL DEFAULT 'not_started',

  -- Step 0: this company's EGS unit identity, as fed into the CSR.
  egs_common_name          TEXT,
  egs_serial_number        TEXT,

  -- Step 1: CSR + keypair.
  private_key_pem_encrypted TEXT,
  public_key_pem            TEXT,
  csr_pem                    TEXT,

  -- Step 2: compliance CSID.
  compliance_request_id         TEXT,
  compliance_csid                TEXT,
  compliance_secret_encrypted    TEXT,
  compliance_csid_issued_at      TIMESTAMPTZ,

  -- Step 3: compliance checks (per document type submitted).
  compliance_checks_passed_at    TIMESTAMPTZ,

  -- Step 4: production CSID.
  production_request_id          TEXT,
  production_csid                 TEXT,
  production_secret_encrypted     TEXT,
  production_csid_issued_at       TIMESTAMPTZ,

  last_error                TEXT,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                UUID REFERENCES users(id)
);

CREATE TRIGGER trg_zatca_onboarding_updated_at
  BEFORE UPDATE ON zatca_onboarding
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE zatca_compliance_checks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zatca_onboarding_id UUID NOT NULL REFERENCES zatca_onboarding(id),
  document_type       TEXT NOT NULL, -- 'standard_invoice', 'standard_credit_note', 'simplified_invoice', 'simplified_credit_note', ...
  source_invoice_id   UUID, -- the sales_invoices/credit_notes row submitted as the sample, if any
  request_uuid        TEXT NOT NULL,
  invoice_hash        TEXT NOT NULL,
  passed              BOOLEAN,
  response_body       JSONB,
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_zatca_compliance_checks_onboarding ON zatca_compliance_checks(zatca_onboarding_id);

INSERT INTO permissions (module, action, code, description) VALUES
  ('admin', 'manage_zatca_onboarding', 'admin.zatca_onboarding.manage', 'Run ZATCA e-invoicing sandbox/production onboarding');
