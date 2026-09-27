-- Item groups: a company-defined grouping of items distinct from brand,
-- category, and season -- typically a store/division/concept the items
-- belong to (e.g. "Podium", "GKids", "Shoe Palace"), not a product
-- attribute. Same shape as brands/categories/seasons (migration 0012):
-- flat, per-company, code + bilingual name, deactivatable rather than
-- deletable so history stays intact.

CREATE TABLE item_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  code        TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  name_ar     TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TRIGGER trg_item_groups_updated_at
  BEFORE UPDATE ON item_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_item_groups_company ON item_groups(company_id);

ALTER TABLE items ADD COLUMN group_id UUID REFERENCES item_groups(id);
CREATE INDEX idx_items_group ON items(group_id);

-- check_item_refs_company (migration 0014) already validates brand/
-- category/season/tax_code all belong to the item's own company in one
-- trigger -- extend it to cover group_id the same way rather than adding
-- a second, near-identical trigger.
CREATE OR REPLACE FUNCTION check_item_refs_company()
RETURNS TRIGGER AS $$
DECLARE
  ref_company_id UUID;
BEGIN
  IF NEW.brand_id IS NOT NULL THEN
    SELECT company_id INTO ref_company_id FROM brands WHERE id = NEW.brand_id;
    IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'brand % does not belong to company %', NEW.brand_id, NEW.company_id;
    END IF;
  END IF;

  IF NEW.category_id IS NOT NULL THEN
    SELECT company_id INTO ref_company_id FROM categories WHERE id = NEW.category_id;
    IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'category % does not belong to company %', NEW.category_id, NEW.company_id;
    END IF;
  END IF;

  IF NEW.season_id IS NOT NULL THEN
    SELECT company_id INTO ref_company_id FROM seasons WHERE id = NEW.season_id;
    IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'season % does not belong to company %', NEW.season_id, NEW.company_id;
    END IF;
  END IF;

  IF NEW.default_tax_code_id IS NOT NULL THEN
    SELECT company_id INTO ref_company_id FROM tax_codes WHERE id = NEW.default_tax_code_id;
    IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'tax code % does not belong to company %', NEW.default_tax_code_id, NEW.company_id;
    END IF;
  END IF;

  IF NEW.group_id IS NOT NULL THEN
    SELECT company_id INTO ref_company_id FROM item_groups WHERE id = NEW.group_id;
    IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'group % does not belong to company %', NEW.group_id, NEW.company_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Seed the three groups asked for, for every existing company -- an admin
-- can add more afterward the same way brands/categories/seasons are added.
INSERT INTO item_groups (company_id, code, name_en, name_ar)
SELECT c.id, 'PODIUM', 'Podium', 'بوديوم' FROM companies c
ON CONFLICT (company_id, code) DO NOTHING;

INSERT INTO item_groups (company_id, code, name_en, name_ar)
SELECT c.id, 'GKIDS', 'GKids', 'جي كيدز' FROM companies c
ON CONFLICT (company_id, code) DO NOTHING;

INSERT INTO item_groups (company_id, code, name_en, name_ar)
SELECT c.id, 'SHOEPALACE', 'Shoe Palace', 'قصر الأحذية' FROM companies c
ON CONFLICT (company_id, code) DO NOTHING;
