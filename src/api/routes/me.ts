import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get("/me", { preHandler: app.authenticate }, async (request) => {
    const roles = await pool.query(
      `SELECT DISTINCT r.id, r.name, ur.store_id
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1 AND ur.company_id = $2`,
      [request.authUser.id, request.companyId],
    );
    const permissions = await pool.query<{ code: string }>(
      `SELECT DISTINCT p.code
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = $1 AND ur.company_id = $2`,
      [request.authUser.id, request.companyId],
    );

    return {
      user: request.authUser,
      companyId: request.companyId,
      roles: roles.rows,
      permissions: permissions.rows.map((r) => r.code),
    };
  });
}
