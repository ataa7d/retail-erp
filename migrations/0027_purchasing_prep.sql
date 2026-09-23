-- Small preparatory additions for Phase 6, kept separate from the
-- purchasing tables themselves: weight for landed-cost-by-weight
-- allocation, and company-level 3-way-match tolerances (different
-- companies in the group may run tighter or looser receiving policies).

ALTER TABLE items ADD COLUMN weight_kg NUMERIC(10,3);

ALTER TABLE companies ADD COLUMN po_qty_tolerance_percent NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN po_price_tolerance_percent NUMERIC(5,2) NOT NULL DEFAULT 5;
