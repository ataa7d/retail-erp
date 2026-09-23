-- Extensions and shared helper functions used across every later migration.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- digest()/hmac() for later ZATCA hash-chain work
CREATE EXTENSION IF NOT EXISTS citext;   -- case-insensitive email addresses

-- Generic "touch updated_at" trigger, attached per-table as needed.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
