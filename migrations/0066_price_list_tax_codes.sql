-- Each price level (retail/POS, wholesale, tender, big-sale, reference)
-- needs its own tax treatment, not just the existing price_includes_vat
-- inclusive/exclusive flag -- a reference (MSRP-style) list is often purely
-- informational and untaxed, while a tender list quoted to a government
-- buyer may use a different VAT code than the shelf price. default_tax_code_id
-- is what a sales line's VAT rate defaults from when priced off this list
-- (still just a starting point -- the invoice line freezes its own rate at
-- the moment of sale, same as price itself).

ALTER TABLE price_lists
  ADD COLUMN default_tax_code_id UUID REFERENCES tax_codes(id);

CREATE OR REPLACE FUNCTION check_price_list_refs_company()
RETURNS TRIGGER AS $$
DECLARE
  ref_company_id UUID;
BEGIN
  IF NEW.default_tax_code_id IS NOT NULL THEN
    SELECT company_id INTO ref_company_id FROM tax_codes WHERE id = NEW.default_tax_code_id;
    IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'tax code % does not belong to company %', NEW.default_tax_code_id, NEW.company_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_price_lists_check_refs
  BEFORE INSERT OR UPDATE ON price_lists
  FOR EACH ROW EXECUTE FUNCTION check_price_list_refs_company();

-- Seed the three price levels that don't already exist as a price list
-- (RETAIL and WHOLESALE were created back in the demo seed script) --
-- TENDER (institutional/government tender pricing), BIGSALE (promotional
-- clearance pricing) and REFERENCE (a purely informational reference/MSRP
-- price, exclusive of VAT since it's not itself a sale price). Applied to
-- every existing company, not just the demo one.
INSERT INTO price_lists (company_id, code, name_en, name_ar, currency, price_includes_vat, default_tax_code_id)
SELECT c.id, 'TENDER', 'Tender Price List', 'قائمة أسعار المناقصات', 'SAR', false,
       (SELECT id FROM tax_codes WHERE company_id = c.id AND code = 'VAT15' LIMIT 1)
FROM companies c
ON CONFLICT (company_id, code) DO NOTHING;

INSERT INTO price_lists (company_id, code, name_en, name_ar, currency, price_includes_vat, default_tax_code_id)
SELECT c.id, 'BIGSALE', 'Big Sale Price List', 'قائمة أسعار التخفيضات الكبرى', 'SAR', true,
       (SELECT id FROM tax_codes WHERE company_id = c.id AND code = 'VAT15' LIMIT 1)
FROM companies c
ON CONFLICT (company_id, code) DO NOTHING;

INSERT INTO price_lists (company_id, code, name_en, name_ar, currency, price_includes_vat, default_tax_code_id)
SELECT c.id, 'REFERENCE', 'Reference Price List', 'قائمة الأسعار المرجعية', 'SAR', false,
       (SELECT id FROM tax_codes WHERE company_id = c.id AND code = 'VAT15' LIMIT 1)
FROM companies c
ON CONFLICT (company_id, code) DO NOTHING;

-- Backfill a default tax code onto the two pre-existing lists too, so every
-- price level actually has one once this migration finishes.
UPDATE price_lists pl
  SET default_tax_code_id = (SELECT id FROM tax_codes tc WHERE tc.company_id = pl.company_id AND tc.code = 'VAT15' LIMIT 1)
  WHERE pl.code IN ('RETAIL', 'WHOLESALE') AND pl.default_tax_code_id IS NULL;

-- "RETAIL" is the till/shelf price -- rename its label to match the term
-- actually used for it (POS price), without touching its code (still
-- referenced by id everywhere, so this is a display-only change).
UPDATE price_lists SET name_en = 'POS Price List', name_ar = 'قائمة أسعار نقطة البيع' WHERE code = 'RETAIL';
