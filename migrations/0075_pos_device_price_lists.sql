-- A cashier picking their own price level at the register is a pricing
-- error waiting to happen -- POS.tsx's price-list dropdown goes away in
-- this feature, replaced by resolving the price list from the till itself
-- (device override, falling back to the store's own default, falling back
-- to the company-wide default price list that already existed). Both new
-- columns are nullable: an unset device just falls through to its store,
-- an unset store falls through to the company default, exactly like today.
ALTER TABLE stores ADD COLUMN default_price_list_id UUID REFERENCES price_lists(id);
ALTER TABLE pos_devices ADD COLUMN price_list_id UUID REFERENCES price_lists(id);
