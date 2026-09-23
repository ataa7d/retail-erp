-- Per-supplier price/lead-time reference (a flat table rather than a full
-- named price-list header+lines structure like sales price_lists — a
-- supplier normally has one quoted price per item, not multiple
-- segmented books).

CREATE TABLE supplier_item_prices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id),
  supplier_id      UUID NOT NULL REFERENCES suppliers(id),
  item_variant_id  UUID NOT NULL REFERENCES item_variants(id),
  unit_cost        NUMERIC(14,2) NOT NULL CHECK (unit_cost >= 0),
  currency         TEXT NOT NULL DEFAULT 'SAR',
  lead_time_days   INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  moq              NUMERIC(14,3) CHECK (moq IS NULL OR moq > 0), -- minimum order quantity
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, item_variant_id)
);

CREATE TRIGGER trg_supplier_item_prices_updated_at
  BEFORE UPDATE ON supplier_item_prices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_supplier_item_prices_company ON supplier_item_prices(company_id);
CREATE INDEX idx_supplier_item_prices_supplier ON supplier_item_prices(supplier_id);

CREATE OR REPLACE FUNCTION check_supplier_item_price_company()
RETURNS TRIGGER AS $$
DECLARE
  v_supplier_company_id UUID;
  v_variant_company_id UUID;
BEGIN
  SELECT company_id INTO v_supplier_company_id FROM suppliers WHERE id = NEW.supplier_id;
  SELECT company_id INTO v_variant_company_id FROM item_variants WHERE id = NEW.item_variant_id;
  IF v_supplier_company_id IS DISTINCT FROM v_variant_company_id OR NEW.company_id IS DISTINCT FROM v_supplier_company_id THEN
    RAISE EXCEPTION 'supplier %, item_variant %, and company % must all match', NEW.supplier_id, NEW.item_variant_id, NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_item_prices_check_company
  BEFORE INSERT OR UPDATE ON supplier_item_prices
  FOR EACH ROW EXECUTE FUNCTION check_supplier_item_price_company();

CREATE TRIGGER trg_supplier_item_prices_audit
  AFTER INSERT OR UPDATE OR DELETE ON supplier_item_prices
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

-- Import documentation tracked against the shipment (goods receipt):
-- certificate of conformity, certificate of origin, customs declaration.
-- No file storage built yet — file_reference is a placeholder for
-- wherever that ends up living (S3 key, path, etc).

CREATE TYPE import_document_type AS ENUM ('coc', 'certificate_of_origin', 'customs_declaration', 'other');

CREATE TABLE import_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  goods_receipt_id  UUID NOT NULL REFERENCES goods_receipts(id),
  document_type     import_document_type NOT NULL,
  document_number   TEXT,
  issue_date        DATE,
  file_reference    TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES users(id)
);

CREATE INDEX idx_import_documents_goods_receipt ON import_documents(goods_receipt_id);
CREATE INDEX idx_import_documents_company ON import_documents(company_id);

CREATE OR REPLACE FUNCTION check_import_document_company()
RETURNS TRIGGER AS $$
DECLARE
  v_receipt_company_id UUID;
BEGIN
  SELECT company_id INTO v_receipt_company_id FROM goods_receipts WHERE id = NEW.goods_receipt_id;
  IF NEW.company_id IS DISTINCT FROM v_receipt_company_id THEN
    RAISE EXCEPTION 'goods receipt % does not belong to company %', NEW.goods_receipt_id, NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_import_documents_check_company
  BEFORE INSERT OR UPDATE ON import_documents
  FOR EACH ROW EXECUTE FUNCTION check_import_document_company();

CREATE TRIGGER trg_import_documents_audit
  AFTER INSERT OR UPDATE OR DELETE ON import_documents
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
