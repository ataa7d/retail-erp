import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { NotFoundError } from "../errors.js";

const createSchema = z.object({
  customerCode: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  customerType: z.enum(["retail", "wholesale", "credit"]).default("retail"),
  crNumber: z.string().nullable().optional(),
  vatRegistrationNumber: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  creditLimit: z.number().nonnegative().nullable().optional(),
  paymentTermsDays: z.number().int().nonnegative().default(0),
  defaultPriceListId: z.string().uuid().nullable().optional(),
});

const termsSchema = z.object({
  crNumber: z.string().nullable().optional(),
  vatRegistrationNumber: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  creditLimit: z.number().nonnegative().nullable().optional(),
  paymentTermsDays: z.number().int().nonnegative(),
  defaultPriceListId: z.string().uuid().nullable().optional(),
});

export async function customerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/customers", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, customer_code, name_en, name_ar, customer_type, cr_number, vat_registration_number,
              address, city, phone, email, credit_limit, payment_terms_days, default_price_list_id,
              is_loyalty_member, loyalty_card_number, is_active
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
             (company_id, customer_code, name_en, name_ar, customer_type, cr_number, vat_registration_number,
              address, city, phone, email, credit_limit, payment_terms_days, default_price_list_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING id`,
          [
            request.companyId,
            body.customerCode,
            body.nameEn,
            body.nameAr,
            body.customerType,
            body.crNumber ?? null,
            body.vatRegistrationNumber ?? null,
            body.address ?? null,
            body.city ?? null,
            body.phone ?? null,
            body.email ?? null,
            body.creditLimit ?? null,
            body.paymentTermsDays,
            body.defaultPriceListId ?? null,
          ],
        );
        return result.rows[0]!.id;
      }, request.authUser.id);
      reply.status(201);
      return { id };
    },
  );

  // B2B commercial terms (credit limit, payment terms, VAT/CR registration,
  // default price list) are edited separately from the one-shot creation
  // form -- a wholesale/credit account's terms change over its lifetime
  // (renegotiated credit limit, a new contracted price list) long after
  // it's first created.
  app.post<{ Params: { id: string } }>(
    "/customers/:id/terms",
    { preHandler: [app.authenticate, app.requirePermission("sales.customer.manage")] },
    async (request) => {
      const body = termsSchema.parse(request.body);
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM customers WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("customer not found");
        await client.query(
          `UPDATE customers
           SET cr_number = $1, vat_registration_number = $2, address = $3, city = $4,
               credit_limit = $5, payment_terms_days = $6, default_price_list_id = $7
           WHERE id = $8`,
          [
            body.crNumber ?? null,
            body.vatRegistrationNumber ?? null,
            body.address ?? null,
            body.city ?? null,
            body.creditLimit ?? null,
            body.paymentTermsDays,
            body.defaultPriceListId ?? null,
            request.params.id,
          ],
        );
      }, request.authUser.id);
      return { id: request.params.id };
    },
  );
}
