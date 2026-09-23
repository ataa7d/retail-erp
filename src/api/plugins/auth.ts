import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import jwt from "@fastify/jwt";
import { pool } from "../db.js";
import { ForbiddenError, UnauthorizedError } from "../errors.js";

export interface AuthUser {
  id: string;
  email: string;
}

declare module "fastify" {
  interface FastifyRequest {
    authUser: AuthUser;
    companyId: string;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (code: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

/**
 * Registered directly on the root app instance (not via app.register(), to
 * avoid Fastify's encapsulation) so `authenticate`/`requirePermission` are
 * visible to every route module registered afterward.
 */
export async function registerAuth(app: FastifyInstance): Promise<void> {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");

  await app.register(jwt, { secret });

  // JWT + user lookup only, no company selected yet — the one thing a
  // frontend needs before it can even offer a company picker, since every
  // other route requires X-Company-Id up front.
  app.decorate("authenticateUser", async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new UnauthorizedError("invalid or missing token");
    }

    const userId = request.user.sub;
    const userResult = await pool.query<{ id: string; email: string; is_active: boolean }>(
      `SELECT id, email, is_active FROM users WHERE id = $1`,
      [userId],
    );
    if (userResult.rows.length === 0 || !userResult.rows[0]!.is_active) {
      throw new UnauthorizedError("user not found or inactive");
    }
    request.authUser = { id: userResult.rows[0]!.id, email: userResult.rows[0]!.email };
  });

  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    await app.authenticateUser(request, reply);

    const companyIdHeader = request.headers["x-company-id"];
    const companyId = Array.isArray(companyIdHeader) ? companyIdHeader[0] : companyIdHeader;
    if (!companyId) {
      throw new UnauthorizedError("X-Company-Id header is required");
    }

    const accessResult = await pool.query(
      `SELECT 1 FROM user_company_access WHERE user_id = $1 AND company_id = $2 AND is_active = true`,
      [request.authUser.id, companyId],
    );
    if (accessResult.rows.length === 0) {
      throw new ForbiddenError("no access to this company");
    }
    request.companyId = companyId;
  });

  app.decorate("requirePermission", (code: string) => {
    return async (request: FastifyRequest) => {
      const result = await pool.query(
        `SELECT 1 FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = $1 AND ur.company_id = $2 AND p.code = $3
         LIMIT 1`,
        [request.authUser.id, request.companyId, code],
      );
      if (result.rows.length === 0) {
        throw new ForbiddenError(`missing permission: ${code}`);
      }
    };
  });
}
