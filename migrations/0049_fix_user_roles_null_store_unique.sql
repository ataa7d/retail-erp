-- The original UNIQUE (user_id, company_id, role_id, store_id) constraint
-- never deduped company-wide grants (store_id IS NULL), because SQL NULLs
-- are never equal to each other in a unique index. Re-granting the same
-- company-wide role repeatedly (e.g. re-running the seed script) silently
-- inserted a fresh row each time instead of hitting the constraint.
--
-- First collapse any duplicates that already accumulated, keeping the
-- earliest grant of each (user, company, role, store) combination, treating
-- NULL store_id as a single value via COALESCE onto a sentinel.
DELETE FROM user_roles ur
USING user_roles keep
WHERE ur.user_id = keep.user_id
  AND ur.company_id = keep.company_id
  AND ur.role_id = keep.role_id
  AND COALESCE(ur.store_id::text, '') = COALESCE(keep.store_id::text, '')
  AND (ur.granted_at, ur.id) > (keep.granted_at, keep.id);

ALTER TABLE user_roles DROP CONSTRAINT user_roles_user_id_company_id_role_id_store_id_key;

-- Split into two partial unique indexes so NULL store_id (company-wide
-- grants) is treated as one value, matching real-world semantics: a user
-- can only be granted a given role company-wide once, and once per store.
CREATE UNIQUE INDEX uq_user_roles_company_wide
  ON user_roles (user_id, company_id, role_id)
  WHERE store_id IS NULL;

CREATE UNIQUE INDEX uq_user_roles_store_scoped
  ON user_roles (user_id, company_id, role_id, store_id)
  WHERE store_id IS NOT NULL;
