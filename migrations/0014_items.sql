-- items: the abstract product. item_variants: the actual sellable/stockable
-- unit (SKU) — every item has at least one variant row (enforced at the
-- application layer, not the database: a DB-level "at least one child
-- exists" constraint is awkward and the create-item flow always creates the
-- first variant in the same transaction). Phase 4/5 invoice lines and stock
-- movements key off item_variant_id, never item_id directly, so there is
-- exactly one identity for "the thing being sold/stocked" regardless of
-- whether the item has color/size variation.

CREATE TABLE items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id),
  item_code           TEXT NOT NULL,
  name_en             TEXT NOT NULL,
  name_ar             TEXT NOT NULL,
  brand_id            UUID REFERENCES brands(id),
  category_id         UUID REFERENCES categories(id),
  season_id           UUID REFERENCES seasons(id),
  item_year           INTEGER,
  default_tax_code_id UUID REFERENCES tax_codes(id),
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, item_code)
);

CREATE TRIGGER trg_items_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_items_company ON items(company_id);
CREATE INDEX idx_items_brand ON items(brand_id);
CREATE INDEX idx_items_category ON items(category_id);

-- Every FK on items (brand/category/season/tax_code) must belong to the
-- same company. One trigger checks all four rather than four near-identical
-- triggers.
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_items_check_refs_company
  BEFORE INSERT OR UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION check_item_refs_company();

-- Units an item can be counted in, and the conversion factor to that item's
-- base unit (exactly one row per item has is_base = true, enforced by the
-- partial unique index below). E.g. a t-shirt: base unit 'PC' (factor 1),
-- alternate unit 'BOX' (factor 12) for receiving from a supplier.
CREATE TABLE item_units (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id            UUID NOT NULL REFERENCES items(id),
  unit_of_measure_id UUID NOT NULL REFERENCES units_of_measure(id),
  conversion_factor  NUMERIC(14,6) NOT NULL CHECK (conversion_factor > 0),
  is_base            BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (item_id, unit_of_measure_id)
);

CREATE UNIQUE INDEX idx_item_units_one_base_per_item
  ON item_units(item_id) WHERE is_base;

CREATE INDEX idx_item_units_item ON item_units(item_id);

-- The base unit's conversion factor must be exactly 1 — it's the reference
-- point every other unit on the item converts against.
ALTER TABLE item_units ADD CONSTRAINT chk_item_units_base_factor_is_one
  CHECK (NOT is_base OR conversion_factor = 1);

CREATE OR REPLACE FUNCTION check_item_unit_company()
RETURNS TRIGGER AS $$
DECLARE
  item_company_id UUID;
  unit_company_id UUID;
BEGIN
  SELECT company_id INTO item_company_id FROM items WHERE id = NEW.item_id;
  SELECT company_id INTO unit_company_id FROM units_of_measure WHERE id = NEW.unit_of_measure_id;
  IF item_company_id IS DISTINCT FROM unit_company_id THEN
    RAISE EXCEPTION 'item % and unit % belong to different companies', NEW.item_id, NEW.unit_of_measure_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_item_units_check_company
  BEFORE INSERT OR UPDATE ON item_units
  FOR EACH ROW EXECUTE FUNCTION check_item_unit_company();

CREATE TABLE item_variants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id),
  item_id      UUID NOT NULL REFERENCES items(id),
  variant_code TEXT NOT NULL,   -- the real SKU used by sales/inventory/purchasing
  color        TEXT,
  size         TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, variant_code),
  UNIQUE (item_id, color, size)
);

CREATE TRIGGER trg_item_variants_updated_at
  BEFORE UPDATE ON item_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_item_variants_company ON item_variants(company_id);
CREATE INDEX idx_item_variants_item ON item_variants(item_id);

CREATE OR REPLACE FUNCTION check_item_variant_company()
RETURNS TRIGGER AS $$
DECLARE
  item_company_id UUID;
BEGIN
  SELECT company_id INTO item_company_id FROM items WHERE id = NEW.item_id;
  IF item_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'item % does not belong to company %', NEW.item_id, NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_item_variants_check_company
  BEFORE INSERT OR UPDATE ON item_variants
  FOR EACH ROW EXECUTE FUNCTION check_item_variant_company();

-- A physical barcode, tied to one of the item's allowed units (a piece
-- barcode and a carton barcode for the same variant are two different rows
-- with the same item_variant_id but different unit_of_measure_id).
CREATE TABLE item_barcodes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES companies(id),
  item_variant_id    UUID NOT NULL REFERENCES item_variants(id),
  unit_of_measure_id UUID NOT NULL REFERENCES units_of_measure(id),
  barcode            TEXT NOT NULL,
  is_primary         BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, barcode)
);

CREATE INDEX idx_item_barcodes_variant ON item_barcodes(item_variant_id);

-- unit_of_measure_id must be one of the units actually registered for this
-- variant's item in item_units (can't scan a barcode in a unit the item was
-- never set up to be counted in).
CREATE OR REPLACE FUNCTION check_item_barcode_unit()
RETURNS TRIGGER AS $$
DECLARE
  v_item_id UUID;
  v_variant_company_id UUID;
  v_allowed BOOLEAN;
BEGIN
  SELECT item_id, company_id INTO v_item_id, v_variant_company_id
    FROM item_variants WHERE id = NEW.item_variant_id;

  IF v_variant_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'item_variant % does not belong to company %', NEW.item_variant_id, NEW.company_id;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM item_units WHERE item_id = v_item_id AND unit_of_measure_id = NEW.unit_of_measure_id
  ) INTO v_allowed;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'unit % is not registered for item %', NEW.unit_of_measure_id, v_item_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_item_barcodes_check_unit
  BEFORE INSERT OR UPDATE ON item_barcodes
  FOR EACH ROW EXECUTE FUNCTION check_item_barcode_unit();
