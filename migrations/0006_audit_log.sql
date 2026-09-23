-- Generic audit trail: one row per INSERT/UPDATE/DELETE on any table we
-- attach the trigger to (done per-table in 0009, as each module's tables
-- are introduced). before/after are full-row JSONB snapshots so "what
-- changed" is always reconstructable without guessing which columns matter.
--
-- actor_user_id comes from a session-local Postgres setting the backend
-- sets at the start of every request/transaction
-- (SET LOCAL app.current_user_id = '<uuid>'), not from an application
-- parameter, so it can't be forgotten at a call site and still applies even
-- to triggers that fire indirectly.

CREATE TABLE audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID,
  table_name     TEXT NOT NULL,
  row_id         UUID NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  actor_user_id  UUID,
  before         JSONB,
  after          JSONB,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_table_row ON audit_log(table_name, row_id);
CREATE INDEX idx_audit_log_company ON audit_log(company_id);
CREATE INDEX idx_audit_log_occurred_at ON audit_log(occurred_at);

CREATE OR REPLACE FUNCTION fn_audit_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_actor UUID;
  v_company_id UUID;
  v_row_id UUID;
BEGIN
  BEGIN
    v_actor := current_setting('app.current_user_id', true)::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  IF TG_OP = 'DELETE' THEN
    v_row_id := OLD.id;
  ELSE
    v_row_id := NEW.id;
  END IF;

  -- company_id is only present on scoped tables; extract it defensively.
  BEGIN
    IF TG_OP = 'DELETE' THEN
      v_company_id := (to_jsonb(OLD) ->> 'company_id')::UUID;
    ELSE
      v_company_id := (to_jsonb(NEW) ->> 'company_id')::UUID;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_company_id := NULL;
  END;

  INSERT INTO audit_log (company_id, table_name, row_id, action, actor_user_id, before, after)
  VALUES (
    v_company_id,
    TG_TABLE_NAME,
    v_row_id,
    TG_OP,
    v_actor,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('UPDATE', 'INSERT') THEN to_jsonb(NEW) ELSE NULL END
  );

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
