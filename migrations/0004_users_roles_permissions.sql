-- Users are a global identity (one login can work across multiple companies
-- in the group). Access to a specific company is granted explicitly via
-- user_company_access, independent of role assignment, so revoking a
-- company doesn't require hunting down and deleting every role row.
--
-- permissions is a system-wide catalog (seed data, not per-company).
-- roles always belong to exactly one company — there is no nullable
-- "global template" row to avoid a trigger validating cross-row company
-- consistency; instead the seed script copies a starter set of roles into
-- every new company.

CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             CITEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  full_name_en      TEXT NOT NULL,
  full_name_ar      TEXT NOT NULL,
  preferred_language TEXT NOT NULL DEFAULT 'ar' CHECK (preferred_language IN ('ar', 'en')),
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_company_access (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  company_id  UUID NOT NULL REFERENCES companies(id),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by  UUID REFERENCES users(id),
  UNIQUE (user_id, company_id)
);

CREATE INDEX idx_user_company_access_company ON user_company_access(company_id);

-- Catalog of every (module, action) the system understands. Seeded once,
-- referenced by every role. code is what application code checks against,
-- e.g. 'sales.pos_invoice.create', 'inventory.adjustment.approve'.
CREATE TABLE permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module      TEXT NOT NULL,
  action      TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

CREATE TABLE roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TRIGGER trg_roles_updated_at
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_roles_company ON roles(company_id);

CREATE TABLE role_permissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id       UUID NOT NULL REFERENCES roles(id),
  permission_id UUID NOT NULL REFERENCES permissions(id),
  UNIQUE (role_id, permission_id)
);

-- A role assignment optionally scoped to one store; store_id NULL means the
-- role applies across every store the user's company access covers.
CREATE TABLE user_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  company_id  UUID NOT NULL REFERENCES companies(id),
  role_id     UUID NOT NULL REFERENCES roles(id),
  store_id    UUID REFERENCES stores(id),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by  UUID REFERENCES users(id),
  UNIQUE (user_id, company_id, role_id, store_id)
);

CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_company ON user_roles(company_id);

-- A role can only be assigned within the company it belongs to, and a store
-- scope (if given) must belong to that same company. Enforced with a
-- trigger since it spans three tables.
CREATE OR REPLACE FUNCTION check_user_role_scope()
RETURNS TRIGGER AS $$
DECLARE
  role_company_id UUID;
  store_company_id UUID;
BEGIN
  SELECT company_id INTO role_company_id FROM roles WHERE id = NEW.role_id;
  IF role_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'role % does not belong to company %', NEW.role_id, NEW.company_id;
  END IF;

  IF NEW.store_id IS NOT NULL THEN
    SELECT company_id INTO store_company_id FROM stores WHERE id = NEW.store_id;
    IF store_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'store % does not belong to company %', NEW.store_id, NEW.company_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_roles_check_scope
  BEFORE INSERT OR UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION check_user_role_scope();
