-- Sales price lists (retail shelf price book, wholesale price book, a
-- promotional list, etc). price_includes_vat is per list, not per line,
-- because a whole book is normally either all-inclusive (retail) or
-- all-exclusive (wholesale) — see rule A. The actual invoice line still
-- freezes its own net/vat/gross at the moment of sale; this table only
-- supplies the starting price.

CREATE TABLE price_lists (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id),
  code                TEXT NOT NULL,
  name_en             TEXT NOT NULL,
  name_ar             TEXT NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'SAR',
  price_includes_vat  BOOLEAN NOT NULL DEFAULT true,
  is_default          BOOLEAN NOT NULL DEFAULT false,
  effective_from      DATE,
  effective_to        DATE,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX idx_price_lists_one_default_per_company
  ON price_lists(company_id) WHERE is_default;

CREATE TRIGGER trg_price_lists_updated_at
  BEFORE UPDATE ON price_lists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_price_lists_company ON price_lists(company_id);

CREATE TABLE price_list_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id   UUID NOT NULL REFERENCES price_lists(id),
  item_variant_id UUID NOT NULL REFERENCES item_variants(id),
  price           NUMERIC(14,2) NOT NULL CHECK (price >= 0),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (price_list_id, item_variant_id)
);

CREATE TRIGGER trg_price_list_items_updated_at
  BEFORE UPDATE ON price_list_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_price_list_items_price_list ON price_list_items(price_list_id);
CREATE INDEX idx_price_list_items_variant ON price_list_items(item_variant_id);

CREATE OR REPLACE FUNCTION check_price_list_item_company()
RETURNS TRIGGER AS $$
DECLARE
  list_company_id UUID;
  variant_company_id UUID;
BEGIN
  SELECT company_id INTO list_company_id FROM price_lists WHERE id = NEW.price_list_id;
  SELECT company_id INTO variant_company_id FROM item_variants WHERE id = NEW.item_variant_id;
  IF list_company_id IS DISTINCT FROM variant_company_id THEN
    RAISE EXCEPTION 'price_list % and item_variant % belong to different companies', NEW.price_list_id, NEW.item_variant_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_price_list_items_check_company
  BEFORE INSERT OR UPDATE ON price_list_items
  FOR EACH ROW EXECUTE FUNCTION check_price_list_item_company();
