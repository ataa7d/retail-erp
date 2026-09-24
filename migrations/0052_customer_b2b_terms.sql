-- B2B customers (wholesale/credit) need a default price list so their
-- contracted pricing applies automatically instead of being picked by hand
-- on every invoice -- retail walk-ins have no need for one, hence nullable.

ALTER TABLE customers ADD COLUMN default_price_list_id UUID REFERENCES price_lists(id);

CREATE OR REPLACE FUNCTION check_customer_refs_company()
RETURNS TRIGGER AS $$
DECLARE
  ref_company_id UUID;
BEGIN
  IF NEW.default_price_list_id IS NOT NULL THEN
    SELECT company_id INTO ref_company_id FROM price_lists WHERE id = NEW.default_price_list_id;
    IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'price list % does not belong to company %', NEW.default_price_list_id, NEW.company_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customers_check_refs_company
  BEFORE INSERT OR UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION check_customer_refs_company();
