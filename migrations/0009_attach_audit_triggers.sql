-- Attach the generic audit trigger to every Phase 1 table whose changes
-- matter for compliance/accountability (who changed a role, who
-- deactivated a store, who edited the chart of accounts). This is broader
-- than "transactional documents" (rule F's deleted_at scope) — audit
-- logging and soft-delete are separate concerns, and admin/config changes
-- are exactly the kind of thing that needs a trail even though these
-- tables never soft-delete.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'companies', 'branches', 'stores', 'users', 'user_company_access',
    'roles', 'role_permissions', 'user_roles',
    'chart_of_accounts', 'fiscal_years', 'fiscal_periods'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%I_audit AFTER INSERT OR UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger()',
      t, t
    );
  END LOOP;
END $$;
