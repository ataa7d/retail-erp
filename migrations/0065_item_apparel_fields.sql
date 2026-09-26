-- Apparel/footwear-relevant attributes requested directly by the business:
-- material/composition and country of origin (customs/labeling), the
-- supplier's own style/model number (distinct from this company's internal
-- item_code), and a standard cost + weight per variant.
--
-- material, country_of_origin and supplier_style_number live on items, not
-- item_variants: a style's fabric composition, country of manufacture and
-- supplier style number don't change across its own color/size variants.
-- standard_cost and weight_kg live on item_variants instead, since a
-- different size genuinely can cost or weigh differently (a size-13 boot
-- uses more leather and weighs more than a size-7) -- putting them on the
-- item would force every variant to share one number that's wrong for at
-- least some of them. standard_cost is a planning/budget figure, distinct
-- from the moving-average actual cost stock_balances already tracks for
-- COGS -- the two serve different purposes and neither should overwrite
-- the other.

ALTER TABLE items
  ADD COLUMN material TEXT,
  ADD COLUMN country_of_origin TEXT,
  ADD COLUMN supplier_style_number TEXT;

ALTER TABLE item_variants
  ADD COLUMN standard_cost NUMERIC(14,2) CHECK (standard_cost >= 0),
  ADD COLUMN weight_kg NUMERIC(10,3) CHECK (weight_kg >= 0);
