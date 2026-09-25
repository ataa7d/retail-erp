import type { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { pool, withTransaction } from "../db.js";
import { NotFoundError, BusinessRuleError } from "../errors.js";

const auditLogQuerySchema = z.object({
  tableName: z.string().optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

const inviteUserSchema = z.object({
  email: z.string().email(),
  fullNameEn: z.string().min(1),
  fullNameAr: z.string().min(1),
  password: z.string().min(8),
  preferredLanguage: z.enum(["ar", "en"]).default("ar"),
});

const createRoleSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
});

const setRolePermissionsSchema = z.object({
  permissionCodes: z.array(z.string()),
});

const assignRoleSchema = z.object({
  roleId: z.string().uuid(),
  storeId: z.string().uuid().nullable().optional(),
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

  // Creates a brand-new user and grants them access to this company. If the
  // email already belongs to an existing user (a real person can have
  // access to multiple companies in the group), grants access to this
  // company instead of erroring -- an admin "inviting" a known colleague
  // shouldn't need to know whether they're already in the system.
  app.post(
    "/admin/users",
    { preHandler: [app.authenticate, app.requirePermission("admin.users.manage")] },
    async (request, reply) => {
      const body = inviteUserSchema.parse(request.body);
      const id = await withTransaction(async (client) => {
        const existing = await client.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [body.email]);
        let userId: string;
        if (existing.rows.length > 0) {
          userId = existing.rows[0]!.id;
        } else {
          const passwordHash = await bcrypt.hash(body.password, 10);
          const created = await client.query<{ id: string }>(
            `INSERT INTO users (email, password_hash, full_name_en, full_name_ar, preferred_language)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [body.email, passwordHash, body.fullNameEn, body.fullNameAr, body.preferredLanguage],
          );
          userId = created.rows[0]!.id;
        }

        await client.query(
          `INSERT INTO user_company_access (user_id, company_id, granted_by) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, company_id) DO UPDATE SET is_active = true`,
          [userId, request.companyId, request.authUser.id],
        );
        return userId;
      }, request.authUser.id);
      reply.status(201);
      return { id };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/users/:id",
    { preHandler: [app.authenticate, app.requirePermission("admin.users.manage")] },
    async (request) => {
      const user = await pool.query(
        `SELECT u.id, u.email, u.full_name_en, u.full_name_ar, u.is_active AS user_is_active, uca.is_active AS has_company_access
         FROM users u JOIN user_company_access uca ON uca.user_id = u.id AND uca.company_id = $2
         WHERE u.id = $1`,
        [request.params.id, request.companyId],
      );
      if (user.rows.length === 0) throw new NotFoundError("user not found in this company");

      const roles = await pool.query(
        `SELECT ur.id, ur.role_id, r.name AS role_name, ur.store_id, s.name_en AS store_name_en
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         LEFT JOIN stores s ON s.id = ur.store_id
         WHERE ur.user_id = $1 AND ur.company_id = $2
         ORDER BY r.name`,
        [request.params.id, request.companyId],
      );
      return { ...user.rows[0], roleAssignments: roles.rows };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/users/:id/deactivate",
    { preHandler: [app.authenticate, app.requirePermission("admin.users.manage")] },
    async (request) => {
      if (request.params.id === request.authUser.id) {
        throw new BusinessRuleError("you cannot deactivate your own access");
      }
      const result = await pool.query(
        `UPDATE user_company_access SET is_active = false WHERE user_id = $1 AND company_id = $2`,
        [request.params.id, request.companyId],
      );
      if (result.rowCount === 0) throw new NotFoundError("user not found in this company");
      return { id: request.params.id, hasCompanyAccess: false };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/users/:id/reactivate",
    { preHandler: [app.authenticate, app.requirePermission("admin.users.manage")] },
    async (request) => {
      const result = await pool.query(
        `UPDATE user_company_access SET is_active = true WHERE user_id = $1 AND company_id = $2`,
        [request.params.id, request.companyId],
      );
      if (result.rowCount === 0) throw new NotFoundError("user not found in this company");
      return { id: request.params.id, hasCompanyAccess: true };
    },
  );

  // A role assignment optionally scoped to one store (user_roles.store_id,
  // migration 0004) -- storeId omitted/null means company-wide.
  app.post<{ Params: { id: string } }>(
    "/admin/users/:id/roles",
    { preHandler: [app.authenticate, app.requirePermission("admin.users.manage")] },
    async (request, reply) => {
      const body = assignRoleSchema.parse(request.body);
      const storeId = body.storeId ?? null;
      // Two partial unique indexes back this (migration 0049 -- NULL
      // store_id needs a WHERE store_id IS NULL match, since plain
      // ON CONFLICT can't target either one at once), so check-then-insert
      // instead of relying on ON CONFLICT.
      const existing = await pool.query<{ id: string }>(
        `SELECT id FROM user_roles
         WHERE user_id = $1 AND company_id = $2 AND role_id = $3
           AND ((store_id IS NULL AND $4::uuid IS NULL) OR store_id = $4)`,
        [request.params.id, request.companyId, body.roleId, storeId],
      );
      if (existing.rows.length > 0) {
        reply.status(200);
        return { id: existing.rows[0]!.id };
      }

      const result = await pool.query<{ id: string }>(
        `INSERT INTO user_roles (user_id, company_id, role_id, store_id, granted_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [request.params.id, request.companyId, body.roleId, storeId, request.authUser.id],
      );
      reply.status(201);
      return { id: result.rows[0]!.id };
    },
  );

  app.post<{ Params: { id: string; userRoleId: string } }>(
    "/admin/users/:id/roles/:userRoleId/remove",
    { preHandler: [app.authenticate, app.requirePermission("admin.users.manage")] },
    async (request) => {
      const result = await pool.query(
        `DELETE FROM user_roles WHERE id = $1 AND user_id = $2 AND company_id = $3`,
        [request.params.userRoleId, request.params.id, request.companyId],
      );
      if (result.rowCount === 0) throw new NotFoundError("role assignment not found");
      return { id: request.params.userRoleId, removed: true };
    },
  );

  app.get(
    "/admin/permissions",
    { preHandler: [app.authenticate, app.requirePermission("admin.roles.manage")] },
    async () => {
      const result = await pool.query(`SELECT id, module, action, code, description FROM permissions ORDER BY module, action`);
      return result.rows;
    },
  );

  app.post(
    "/admin/roles",
    { preHandler: [app.authenticate, app.requirePermission("admin.roles.manage")] },
    async (request, reply) => {
      const body = createRoleSchema.parse(request.body);
      const result = await pool.query<{ id: string }>(
        `INSERT INTO roles (company_id, name, description) VALUES ($1, $2, $3) RETURNING id`,
        [request.companyId, body.name, body.description ?? null],
      );
      reply.status(201);
      return { id: result.rows[0]!.id };
    },
  );

  // Replaces the role's entire permission set in one call rather than
  // add/remove one at a time -- the admin UI always edits the full
  // checkbox list at once, so "replace" matches how it's actually used.
  app.post<{ Params: { id: string } }>(
    "/admin/roles/:id/permissions",
    { preHandler: [app.authenticate, app.requirePermission("admin.roles.manage")] },
    async (request) => {
      const body = setRolePermissionsSchema.parse(request.body);
      await withTransaction(async (client) => {
        const role = await client.query(`SELECT id FROM roles WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (role.rows.length === 0) throw new NotFoundError("role not found");

        await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [request.params.id]);
        if (body.permissionCodes.length > 0) {
          await client.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT $1, id FROM permissions WHERE code = ANY($2::text[])`,
            [request.params.id, body.permissionCodes],
          );
        }
      }, request.authUser.id);
      return { id: request.params.id };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/roles/:id/deactivate",
    { preHandler: [app.authenticate, app.requirePermission("admin.roles.manage")] },
    async (request) => {
      const result = await pool.query(`UPDATE roles SET is_active = false WHERE id = $1 AND company_id = $2`, [
        request.params.id,
        request.companyId,
      ]);
      if (result.rowCount === 0) throw new NotFoundError("role not found");
      return { id: request.params.id, isActive: false };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/roles/:id/reactivate",
    { preHandler: [app.authenticate, app.requirePermission("admin.roles.manage")] },
    async (request) => {
      const result = await pool.query(`UPDATE roles SET is_active = true WHERE id = $1 AND company_id = $2`, [
        request.params.id,
        request.companyId,
      ]);
      if (result.rowCount === 0) throw new NotFoundError("role not found");
      return { id: request.params.id, isActive: true };
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
