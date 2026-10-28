import { pool } from "./db.js";

/**
 * Non-throwing permission check, for deciding whether to include one field
 * in an otherwise-allowed response (e.g. item cost) -- as opposed to
 * `requirePermission` (plugins/auth.ts), which blocks the whole route and
 * is wrong for this: a user without inventory.items.view_cost should still
 * get the item, just without its cost field, not a 403.
 */
export async function userHasPermission(userId: string, companyId: string, code: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = $1 AND ur.company_id = $2 AND p.code = $3
     LIMIT 1`,
    [userId, companyId, code],
  );
  return result.rows.length > 0;
}
