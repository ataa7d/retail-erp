-- Gap-free, concurrency-safe document numbering, generic across every
-- document type introduced from Phase 4 onward. One row per
-- (company, document_type, fiscal_year); fn_next_document_number locks that
-- row with SELECT ... FOR UPDATE so concurrent POS terminals/branches never
-- race for the same number, and increments it in the caller's own
-- transaction so a rolled-back document still leaves a gap-free sequence
-- (the number was truly consumed, matching how physical invoice books work).

CREATE TABLE number_sequences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id),
  document_type TEXT NOT NULL,      -- e.g. 'pos_invoice', 'credit_note', 'journal'
  fiscal_year   INTEGER NOT NULL,
  prefix        TEXT NOT NULL DEFAULT '',
  padding       INTEGER NOT NULL DEFAULT 6,
  next_value    BIGINT NOT NULL DEFAULT 1,
  UNIQUE (company_id, document_type, fiscal_year)
);

CREATE OR REPLACE FUNCTION fn_next_document_number(
  p_company_id UUID,
  p_document_type TEXT,
  p_fiscal_year INTEGER,
  p_default_prefix TEXT DEFAULT NULL
) RETURNS TEXT AS $$
DECLARE
  v_next BIGINT;
  v_prefix TEXT;
  v_padding INTEGER;
BEGIN
  -- Lock (or create) the row for this company/type/year so concurrent
  -- callers serialize here instead of racing on the same next_value.
  INSERT INTO number_sequences (company_id, document_type, fiscal_year, prefix)
  VALUES (p_company_id, p_document_type, p_fiscal_year, COALESCE(p_default_prefix, ''))
  ON CONFLICT (company_id, document_type, fiscal_year) DO NOTHING;

  SELECT next_value, prefix, padding
    INTO v_next, v_prefix, v_padding
    FROM number_sequences
    WHERE company_id = p_company_id
      AND document_type = p_document_type
      AND fiscal_year = p_fiscal_year
    FOR UPDATE;

  UPDATE number_sequences
    SET next_value = v_next + 1
    WHERE company_id = p_company_id
      AND document_type = p_document_type
      AND fiscal_year = p_fiscal_year;

  RETURN v_prefix || p_fiscal_year::TEXT || '-' || LPAD(v_next::TEXT, v_padding, '0');
END;
$$ LANGUAGE plpgsql;
