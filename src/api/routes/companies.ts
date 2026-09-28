import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { NotFoundError } from "../errors.js";

// The one route a frontend can call before it has a company selected —
// list the companies this user actually has access to, so it can show a
// company picker. Every other route requires X-Company-Id up front.
export async function companyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/companies", { preHandler: app.authenticateUser }, async (request) => {
    const result = await pool.query(
      `SELECT c.id, c.company_code, c.name_en, c.name_ar, c.base_currency
       FROM companies c
       JOIN user_company_access uca ON uca.company_id = c.id
       WHERE uca.user_id = $1 AND uca.is_active = true
       ORDER BY c.name_en`,
      [request.authUser.id],
    );
    return result.rows;
  });

  // The seller-side details a printed invoice needs (name, VAT number, CR
  // number) that the company picker above deliberately doesn't return --
  // that route runs before a company is even selected, this one requires
  // X-Company-Id like every other authenticated route.
  app.get("/companies/current", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, company_code, name_en, name_ar, vat_registration_number, cr_number, base_currency
       FROM companies WHERE id = $1`,
      [request.companyId],
    );
    if (result.rows.length === 0) throw new NotFoundError("company not found");
    return result.rows[0];
  });
}
