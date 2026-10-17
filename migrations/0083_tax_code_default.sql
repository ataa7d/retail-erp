-- Which standard-rate tax code is "the" company VAT rate was previously
-- implicit (POS guessed: first active standard code, alphabetically by
-- code). That breaks down for any company with more than one standard-rate
-- code (e.g. a reduced or promotional rate also marked tax_type='standard').
-- This makes the choice explicit and persisted instead of guessed per-read.

ALTER TABLE tax_codes ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT false;

-- At most one default per company.
CREATE UNIQUE INDEX uq_tax_codes_one_default_per_company ON tax_codes (company_id) WHERE is_default;

-- Backfill: prefer the "STD"-coded row (what companyBootstrapService.ts
-- seeds every new company with); otherwise fall back to the same
-- alphabetically-first-active-standard heuristic POS used before this
-- column existed, so no company's effective rate changes as a result of
-- this migration.
WITH ranked AS (
  SELECT id, company_id,
         ROW_NUMBER() OVER (
           PARTITION BY company_id
           ORDER BY (code = 'STD') DESC, code
         ) AS rn
  FROM tax_codes
  WHERE tax_type = 'standard' AND is_active
)
UPDATE tax_codes t
SET is_default = true
FROM ranked r
WHERE t.id = r.id AND r.rn = 1;
