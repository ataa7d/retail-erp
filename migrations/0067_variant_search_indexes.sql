-- Supports the "all variants" grid: a flat, searchable, filterable list of
-- every item_variant across the whole catalog, expected to scale into the
-- millions of rows. A plain ILIKE '%term%' can't use a normal btree index,
-- so every text column the grid searches or filters gets a trigram (GIN)
-- index instead -- substring search stays index-backed at that scale
-- instead of degrading into a sequential scan.
--
-- (These are plain CREATE INDEX, not CONCURRENTLY, because this project's
-- migration runner wraps each file in one transaction and Postgres forbids
-- CONCURRENTLY inside a transaction block -- fine for this app's current
-- data volume; a genuinely million-row production table would need these
-- built via a one-off CONCURRENTLY run outside the normal migration path.)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_items_item_code_trgm ON items USING GIN (item_code gin_trgm_ops);
CREATE INDEX idx_items_name_en_trgm ON items USING GIN (name_en gin_trgm_ops);
CREATE INDEX idx_items_name_ar_trgm ON items USING GIN (name_ar gin_trgm_ops);

CREATE INDEX idx_item_variants_variant_code_trgm ON item_variants USING GIN (variant_code gin_trgm_ops);
CREATE INDEX idx_item_variants_color_trgm ON item_variants USING GIN (color gin_trgm_ops);
CREATE INDEX idx_item_variants_size_trgm ON item_variants USING GIN (size gin_trgm_ops);

CREATE INDEX idx_item_barcodes_barcode_trgm ON item_barcodes USING GIN (barcode gin_trgm_ops);

-- The grid's status/brand/category/season filters are exact-match, already
-- covered by existing btree indexes (idx_items_brand, idx_items_category)
-- or small enough tables (seasons) not to need one -- item_variants had no
-- index on is_active or season lookups via its parent item, which the
-- query planner can still reach efficiently through idx_items_category et
-- al. joined off item_id.
CREATE INDEX idx_item_variants_active ON item_variants(company_id, is_active);
