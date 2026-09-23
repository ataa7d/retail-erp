import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../db.js";
import { UnauthorizedError } from "../errors.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
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
