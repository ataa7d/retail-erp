-- received_qty is system-maintained (recomputed whenever a goods receipt
-- against this line posts) and must be able to change after the purchase
-- order itself is posted/approved — that's the whole point of receiving.
-- Exempt only that column from the otherwise-immutable-once-posted rule;
-- every other column on a posted PO line still cannot change.

CREATE OR REPLACE FUNCTION check_purchase_order_line_immutable()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.company_id = OLD.company_id AND NEW.purchase_order_id = OLD.purchase_order_id
     AND NEW.line_number = OLD.line_number AND NEW.item_variant_id = OLD.item_variant_id
     AND NEW.qty = OLD.qty AND NEW.unit_price = OLD.unit_price AND NEW.discount_amount = OLD.discount_amount
     AND NEW.vat_rate = OLD.vat_rate AND NEW.price_includes_vat = OLD.price_includes_vat
     AND NEW.net_amount = OLD.net_amount AND NEW.vat_amount = OLD.vat_amount AND NEW.gross_amount = OLD.gross_amount
  THEN
    RETURN NEW; -- only received_qty (or nothing) changed
  END IF;

  SELECT document_status INTO v_status FROM purchase_orders
    WHERE id = COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'purchase order % is posted; its lines are immutable', COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
