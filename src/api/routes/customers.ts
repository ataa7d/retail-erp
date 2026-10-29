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

const loyaltySchema = z.object({
  isLoyaltyMember: z.boolean(),
  loyaltyCardNumber: z.string().nullable().optional(),
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

const noteSchema = z.object({
  note: z.string().min(1),
});

const tagsSchema = z.object({
  tags: z.array(z.string().min(1)),
});

const purchaseHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export async function customerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/customers", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, customer_code, name_en, name_ar, customer_type, cr_number, vat_registration_number,
              address, city, phone, email, credit_limit, payment_terms_days, default_price_list_id,
              is_loyalty_member, loyalty_card_number, loyalty_points_balance, lifetime_points_earned,
              loyalty_tier_id, tags, is_active
       FROM customers WHERE company_id = $1 ORDER BY name_en`,
      [request.companyId],
    );
    return result.rows;
  });

  app.post(
    "/customers",
    { preHandler: [app.authenticate, app.requirePermission("sales.customer.create")] },
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
    { preHandler: [app.authenticate, app.requirePermission("sales.customer.edit")] },
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

  // Loyalty enrollment (is_loyalty_member / loyalty_card_number) is edited
  // separately from B2B terms above -- it's a retail-customer concern, not
  // a commercial-terms one, and unrelated to credit limits/price lists.
  app.post<{ Params: { id: string } }>(
    "/customers/:id/loyalty",
    { preHandler: [app.authenticate, app.requirePermission("sales.customer.edit")] },
    async (request) => {
      const body = loyaltySchema.parse(request.body);
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM customers WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("customer not found");
        await client.query(`UPDATE customers SET is_loyalty_member = $1, loyalty_card_number = $2 WHERE id = $3`, [
          body.isLoyaltyMember,
          body.loyaltyCardNumber ?? null,
          request.params.id,
        ]);
      }, request.authUser.id);
      return { id: request.params.id };
    },
  );

  // POS phone-number lookup, mandatory customer capture (Pos.tsx). Exact
  // match on digits-only, so "+966 50 123 4567" and "0501234567" both
  // find the same record regardless of how either was typed/stored --
  // phone has no format constraint today (nothing enforces E.164 or a
  // Saudi mobile pattern), so a loose digits-only compare is the only
  // reliable match.
  app.get("/customers/lookup", { preHandler: app.authenticate }, async (request) => {
    const query = z.object({ phone: z.string().min(1) }).parse(request.query);
    const digits = query.phone.replace(/\D/g, "");
    if (!digits) return { customer: null };
    const result = await pool.query(
      `SELECT id, customer_code, name_en, name_ar, customer_type, phone,
              is_loyalty_member, loyalty_card_number, loyalty_points_balance
       FROM customers
       WHERE company_id = $1 AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $2
       LIMIT 1`,
      [request.companyId, digits],
    );
    return { customer: result.rows[0] ?? null };
  });

  app.get<{ Params: { id: string } }>("/customers/:id/notes", { preHandler: app.authenticate }, async (request) => {
    const existing = await pool.query(`SELECT id FROM customers WHERE id = $1 AND company_id = $2`, [
      request.params.id,
      request.companyId,
    ]);
    if (existing.rows.length === 0) throw new NotFoundError("customer not found");

    const result = await pool.query(
      `SELECT cn.id, cn.note, cn.created_at, u.email AS author_email
       FROM customer_notes cn
       LEFT JOIN users u ON u.id = cn.author_user_id
       WHERE cn.customer_id = $1
       ORDER BY cn.created_at DESC`,
      [request.params.id],
    );
    return result.rows;
  });

  app.post<{ Params: { id: string } }>(
    "/customers/:id/notes",
    { preHandler: [app.authenticate, app.requirePermission("sales.customer.notes.manage")] },
    async (request, reply) => {
      const body = noteSchema.parse(request.body);
      const id = await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM customers WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("customer not found");
        const result = await client.query<{ id: string }>(
          `INSERT INTO customer_notes (company_id, customer_id, author_user_id, note) VALUES ($1, $2, $3, $4) RETURNING id`,
          [request.companyId, request.params.id, request.authUser.id, body.note],
        );
        return result.rows[0]!.id;
      }, request.authUser.id);
      reply.status(201);
      return { id };
    },
  );

  // Replaces the full tag set, same semantics as role permission
  // assignment elsewhere -- the caller sends the complete list it wants,
  // not an incremental add/remove.
  app.post<{ Params: { id: string } }>(
    "/customers/:id/tags",
    { preHandler: [app.authenticate, app.requirePermission("sales.customer.tags.manage")] },
    async (request) => {
      const body = tagsSchema.parse(request.body);
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM customers WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("customer not found");
        await client.query(`UPDATE customers SET tags = $1 WHERE id = $2`, [body.tags, request.params.id]);
      }, request.authUser.id);
      return { id: request.params.id, tags: body.tags };
    },
  );

  // Merchandise order history -- distinct from fn_customer_statement
  // (reports.ts), which is an AR running-balance statement, not a
  // line-item purchase history.
  app.get<{ Params: { id: string } }>(
    "/customers/:id/purchase-history",
    { preHandler: [app.authenticate, app.requirePermission("sales.customer.purchase_history.view")] },
    async (request) => {
      const existing = await pool.query(`SELECT id FROM customers WHERE id = $1 AND company_id = $2`, [
        request.params.id,
        request.companyId,
      ]);
      if (existing.rows.length === 0) throw new NotFoundError("customer not found");

      const query = purchaseHistoryQuerySchema.parse(request.query);
      const offset = (query.page - 1) * query.pageSize;

      const result = await pool.query(
        `SELECT si.id, si.document_number, si.invoice_date, si.document_status, si.gross_amount, c.base_currency AS currency,
                json_agg(json_build_object('description', sil.item_description, 'qty', sil.qty, 'grossAmount', sil.gross_amount)
                         ORDER BY sil.line_number) AS lines,
                COUNT(*) OVER() AS total_count
         FROM sales_invoices si
         JOIN companies c ON c.id = si.company_id
         JOIN sales_invoice_lines sil ON sil.invoice_id = si.id
         WHERE si.customer_id = $1 AND si.company_id = $2
         GROUP BY si.id, c.base_currency
         ORDER BY si.invoice_date DESC, si.created_at DESC
         LIMIT $3 OFFSET $4`,
        [request.params.id, request.companyId, query.pageSize, offset],
      );
      const total = result.rows.length > 0 ? Number(result.rows[0]!.total_count) : 0;
      const rows = result.rows.map(({ total_count, ...row }) => row);
      return { rows, total, page: query.page, pageSize: query.pageSize };
    },
  );

  app.get<{ Params: { id: string } }>("/customers/:id/loyalty-transactions", { preHandler: app.authenticate }, async (request) => {
    const existing = await pool.query(`SELECT id FROM customers WHERE id = $1 AND company_id = $2`, [
      request.params.id,
      request.companyId,
    ]);
    if (existing.rows.length === 0) throw new NotFoundError("customer not found");

    const result = await pool.query(
      `SELECT lpt.*, si.document_number AS sales_invoice_number
       FROM loyalty_points_transactions lpt
       LEFT JOIN sales_invoices si ON si.id = lpt.sales_invoice_id
       WHERE lpt.customer_id = $1
       ORDER BY lpt.created_at DESC`,
      [request.params.id],
    );
    return result.rows;
  });
}
