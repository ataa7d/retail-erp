DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'units_of_measure', 'brands', 'categories', 'seasons', 'tax_codes',
    'items', 'item_units', 'item_variants', 'item_barcodes',
    'customers', 'suppliers',
    'price_lists', 'price_list_items'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%I_audit AFTER INSERT OR UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger()',
      t, t
    );
  END LOOP;
END $$;
