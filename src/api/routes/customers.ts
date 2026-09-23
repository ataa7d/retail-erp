import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";

export async function customerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/customers", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, customer_code, name_en, name_ar, customer_type, vat_registration_number,
              credit_limit, payment_terms_days, is_loyalty_member, loyalty_card_number, is_active
       FROM customers WHERE company_id = $1 ORDER BY name_en`,
      [request.companyId],
    );
    return result.rows;
  });
}
