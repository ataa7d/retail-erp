import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

const auditLogQuerySchema = z.object({
  tableName: z.string().optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // Users scoped to this company via user_company_access, with their roles
  // — not a global user list, since a user's access to other companies
  // isn't this company's business to expose.
  app.get(
    "/admin/users",
    { preHandler: [app.authenticate, app.requirePermission("admin.users.manage")] },
    async (request) => {
      const result = await pool.query(
        `SELECT u.id, u.email, u.full_name_en, u.full_name_ar, u.is_active AS user_is_active,
                uca.is_active AS has_company_access,
                COALESCE(json_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '[]') AS roles
         FROM users u
         JOIN user_company_access uca ON uca.user_id = u.id AND uca.company_id = $1
         LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.company_id = $1
         LEFT JOIN roles r ON r.id = ur.role_id
         GROUP BY u.id, uca.is_active
         ORDER BY u.email`,
        [request.companyId],
      );
      return result.rows;
    },
  );

  app.get(
    "/admin/roles",
    { preHandler: [app.authenticate, app.requirePermission("admin.roles.manage")] },
    async (request) => {
      const result = await pool.query(
        `SELECT r.id, r.name, r.description, r.is_active,
                COALESCE(json_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '[]') AS permissions
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
         WHERE r.company_id = $1
         GROUP BY r.id
         ORDER BY r.name`,
        [request.companyId],
      );
      return result.rows;
    },
  );

  app.get(
    "/admin/audit-log",
    { preHandler: [app.authenticate, app.requirePermission("admin.audit_log.view")] },
    async (request) => {
      const query = auditLogQuerySchema.parse(request.query);
      const result = await pool.query(
        `SELECT id, table_name, row_id, action, actor_user_id, before, after, occurred_at
         FROM audit_log
         WHERE company_id = $1
           AND ($2::text IS NULL OR table_name = $2)
           AND ($3::timestamptz IS NULL OR occurred_at > $3)
         ORDER BY occurred_at DESC
         LIMIT $4`,
        [request.companyId, query.tableName ?? null, query.since ?? null, query.limit],
      );
      return result.rows;
    },
  );
}
