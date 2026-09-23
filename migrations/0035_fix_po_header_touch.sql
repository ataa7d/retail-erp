-- The received_qty-only update from 0034 was still cascading into the
-- header-touch trigger, which then hit the posted-PO immutability guard on
-- purchase_orders itself. received_qty never affects header money totals,
-- so skip the touch entirely when that's the only thing that changed.

CREATE OR REPLACE FUNCTION touch_purchase_order_header()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.net_amount = OLD.net_amount AND NEW.vat_amount = OLD.vat_amount AND NEW.gross_amount = OLD.gross_amount
  THEN
    RETURN NULL; -- a received_qty-only change; nothing header-relevant to recompute
  END IF;

  UPDATE purchase_orders SET id = id WHERE id = COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
