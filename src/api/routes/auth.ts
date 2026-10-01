import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../db.js";
import { UnauthorizedError } from "../errors.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const stepUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  permission: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Step-up authorization: the current session stays untouched -- this
  // just checks whether a *different* user's credentials are valid and
  // that user holds the given permission, for flows like the POS manager
  // override on a discount. No token is issued; it's a yes/no check.
  app.post(
    "/verify-step-up",
    { preHandler: app.authenticate },
    async (request) => {
      const body = stepUpSchema.parse(request.body);

      const userResult = await pool.query<{ id: string; password_hash: string; is_active: boolean }>(
        `SELECT id, password_hash, is_active FROM users WHERE email = $1`,
        [body.email],
      );
      if (userResult.rows.length === 0) throw new UnauthorizedError("invalid email or password");
      const user = userResult.rows[0]!;
      if (!user.is_active) throw new UnauthorizedError("account is inactive");

      const passwordOk = await bcrypt.compare(body.password, user.password_hash);
      if (!passwordOk) throw new UnauthorizedError("invalid email or password");

      const permResult = await pool.query(
        `SELECT 1 FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = $1 AND ur.company_id = $2 AND p.code = $3
         LIMIT 1`,
        [user.id, request.companyId, body.permission],
      );
      if (permResult.rows.length === 0) throw new UnauthorizedError("that user doesn't have permission to authorize this");

      return { ok: true, authorizedByEmail: body.email };
    },
  );

  app.post("/login", async (request) => {
    const body = loginSchema.parse(request.body);

    const userResult = await pool.query<{ id: string; password_hash: string; is_active: boolean; full_name_en: string; full_name_ar: string }>(
      `SELECT id, password_hash, is_active, full_name_en, full_name_ar FROM users WHERE email = $1`,
      [body.email],
    );
    if (userResult.rows.length === 0) {
      throw new UnauthorizedError("invalid email or password");
    }
    const user = userResult.rows[0]!;
    if (!user.is_active) {
      throw new UnauthorizedError("account is inactive");
    }

    const passwordOk = await bcrypt.compare(body.password, user.password_hash);
    if (!passwordOk) {
      throw new UnauthorizedError("invalid email or password");
    }

    const companies = await pool.query(
      `SELECT c.id, c.company_code, c.name_en, c.name_ar
       FROM user_company_access uca
       JOIN companies c ON c.id = uca.company_id
       WHERE uca.user_id = $1 AND uca.is_active = true`,
      [user.id],
    );

    const token = await app.jwt.sign({ sub: user.id }, { expiresIn: "12h" });

    return {
      token,
      user: { id: user.id, fullNameEn: user.full_name_en, fullNameAr: user.full_name_ar },
      companies: companies.rows,
    };
  });
}
