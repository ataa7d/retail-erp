import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";

const createSchema = z.object({
  customerCode: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  customerType: z.enum(["retail", "wholesale", "credit"]).default("retail"),
  vatRegistrationNumber: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  creditLimit: z.number().nonnegative().nullable().optional(),
  paymentTermsDays: z.number().int().nonnegative().default(0),
});

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

  app.post(
    "/customers",
    { preHandler: [app.authenticate, app.requirePermission("sales.customer.manage")] },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      const id = await withTransaction(async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO customers
             (company_id, customer_code, name_en, name_ar, customer_type, vat_registration_number,
              phone, email, credit_limit, payment_terms_days)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [
            request.companyId,
            body.customerCode,
            body.nameEn,
            body.nameAr,
            body.customerType,
            body.vatRegistrationNumber ?? null,
            body.phone ?? null,
            body.email ?? null,
            body.creditLimit ?? null,
            body.paymentTermsDays,
          ],
        );
        return result.rows[0]!.id;
      }, request.authUser.id);
      reply.status(201);
      return { id };
    },
  );
}
