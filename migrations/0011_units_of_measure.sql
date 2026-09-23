-- Base catalog of units (piece, box, carton, kg, ...). Per-item conversion
-- factors live on item_units (0014), not here — a "carton" means a
-- different quantity for different items.

CREATE TABLE units_of_measure (
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

CREATE TRIGGER trg_units_of_measure_updated_at
  BEFORE UPDATE ON units_of_measure
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_units_of_measure_company ON units_of_measure(company_id);
