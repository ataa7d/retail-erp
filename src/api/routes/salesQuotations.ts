import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import {
  createSalesQuotation,
  sendSalesQuotation,
  withdrawSalesQuotation,
  acceptSalesQuotation,
  rejectSalesQuotation,
  convertSalesQuotationToInvoice,
} from "../../sales/salesService.js";
import { NotFoundError, BusinessRuleError } from "../errors.js";
import { resolveFiscalPeriodId } from "../../accounting/fiscalPeriods.js";

const lineSchema = z.object({
  itemVariantId: z.string().uuid(),
  itemDescription: z.string().min(1),
  qty: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discountAmount: z.number().nonnegative().default(0),
  vatRate: z.number().nonnegative(),
  priceIncludesVat: z.boolean(),
});

const createSchema = z.object({
  storeId: z.string().uuid(),
  customerId: z.string().uuid(),
  salespersonId: z.string().uuid().nullable().optional(),
  priceListId: z.string().uuid().nullable().optional(),
  quotationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(lineSchema).min(1),
});

const rejectSchema = z.object({
  rejectionReason: z.string().min(1),
});

const convertSchema = z.object({
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function salesQuotationRoutes(app: FastifyInstance): Promise<void> {
  // ---- Sales Quotations (draft -> sent -> accepted/rejected/withdrawn ->
  // converted_to_invoice; see migration 0063 for the full state machine) ----

  app.post(
    "/sales-quotations",
    { preHandler: [app.authenticate, app.requirePermission("sales.quotation.create")] },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      const id = await withTransaction(
        (client) =>
          createSalesQuotation(client, {
            companyId: request.companyId,
            storeId: body.storeId,
            customerId: body.customerId,
            salespersonId: body.salespersonId ?? request.authUser.id,
            priceListId: body.priceListId ?? null,
            quotationDate: body.quotationDate,
            validUntil: body.validUntil ?? null,
            notes: body.notes ?? null,
            lines: body.lines,
            createdBy: request.authUser.id,
          }),
        request.authUser.id,
      );
      reply.status(201);
      return { id };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/sales-quotations/:id/send",
    { preHandler: [app.authenticate, app.requirePermission("sales.quotation.create")] },
    async (request) => {
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM sales_quotations WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("sales quotation not found");
        await sendSalesQuotation(client, request.params.id);
      }, request.authUser.id);
      return { id: request.params.id, status: "sent" };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/sales-quotations/:id/withdraw",
    { preHandler: [app.authenticate, app.requirePermission("sales.quotation.create")] },
    async (request) => {
      await withTransaction(async (client) => {
        const existing = await client.query(
          `SELECT id, created_by, document_status FROM sales_quotations WHERE id = $1 AND company_id = $2`,
          [request.params.id, request.companyId],
        );
        if (existing.rows.length === 0) throw new NotFoundError("sales quotation not found");
        if (existing.rows[0]!.created_by !== request.authUser.id) {
          throw new BusinessRuleError("only the quotation's own creator can withdraw it");
        }
        if (existing.rows[0]!.document_status !== "sent") {
          throw new BusinessRuleError("only a sent quotation can be withdrawn");
        }
        await withdrawSalesQuotation(client, request.params.id);
      }, request.authUser.id);
      return { id: request.params.id, status: "withdrawn" };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/sales-quotations/:id/accept",
    { preHandler: [app.authenticate, app.requirePermission("sales.quotation.decide")] },
    async (request) => {
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM sales_quotations WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("sales quotation not found");
        await acceptSalesQuotation(client, request.params.id, request.authUser.id);
      }, request.authUser.id);
      return { id: request.params.id, status: "accepted" };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/sales-quotations/:id/reject",
    { preHandler: [app.authenticate, app.requirePermission("sales.quotation.decide")] },
    async (request) => {
      const body = rejectSchema.parse(request.body);
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM sales_quotations WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("sales quotation not found");
        await rejectSalesQuotation(client, request.params.id, request.authUser.id, body.rejectionReason);
      }, request.authUser.id);
      return { id: request.params.id, status: "rejected" };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/sales-quotations/:id/convert",
    { preHandler: [app.authenticate, app.requirePermission("sales.wholesale_invoice.create")] },
    async (request, reply) => {
      const body = convertSchema.parse(request.body);
      const existing = await pool.query(
        `SELECT id, document_status, store_id, customer_id, salesperson_id, price_list_id FROM sales_quotations WHERE id = $1 AND company_id = $2`,
        [request.params.id, request.companyId],
      );
      if (existing.rows.length === 0) throw new NotFoundError("sales quotation not found");
      if (existing.rows[0]!.document_status !== "accepted") {
        throw new BusinessRuleError("sales quotation must be accepted before it can be converted to an invoice");
      }
      const quotation = existing.rows[0]!;

      const invoiceId = await withTransaction(
        async (client) =>
          convertSalesQuotationToInvoice(client, {
            quotationId: request.params.id,
            companyId: request.companyId,
            storeId: quotation.store_id,
            customerId: quotation.customer_id,
            invoiceDate: body.invoiceDate,
            fiscalPeriodId: await resolveFiscalPeriodId(client, request.companyId, body.invoiceDate),
            salespersonId: quotation.salesperson_id,
            priceListId: quotation.price_list_id,
            createdBy: request.authUser.id,
          }),
        request.authUser.id,
      );
      reply.status(201);
      return { salesInvoiceId: invoiceId };
    },
  );

  app.get("/sales-quotations", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT sq.id, sq.document_number, sq.quotation_date, sq.valid_until, sq.document_status,
              sq.gross_amount, sq.rejection_reason,
              c.name_en AS customer_name_en, c.name_ar AS customer_name_ar,
              u.email AS created_by_email
       FROM sales_quotations sq
       JOIN customers c ON c.id = sq.customer_id
       LEFT JOIN users u ON u.id = sq.created_by
       WHERE sq.company_id = $1
       ORDER BY sq.quotation_date DESC, sq.created_at DESC
       LIMIT 200`,
      [request.companyId],
    );
    return result.rows;
  });

  app.get<{ Params: { id: string } }>("/sales-quotations/:id", { preHandler: app.authenticate }, async (request) => {
    const header = await pool.query(
      `SELECT sq.*, c.name_en AS customer_name_en, c.name_ar AS customer_name_ar,
              u.email AS created_by_email, du.email AS decided_by_email
       FROM sales_quotations sq
       JOIN customers c ON c.id = sq.customer_id
       LEFT JOIN users u ON u.id = sq.created_by
       LEFT JOIN users du ON du.id = sq.decided_by
       WHERE sq.id = $1 AND sq.company_id = $2`,
      [request.params.id, request.companyId],
    );
    if (header.rows.length === 0) throw new NotFoundError("sales quotation not found");

    const lines = await pool.query(
      `SELECT sqline.*, iv.variant_code
       FROM sales_quotation_lines sqline
       JOIN item_variants iv ON iv.id = sqline.item_variant_id
       WHERE sqline.quotation_id = $1
       ORDER BY sqline.line_number`,
      [request.params.id],
    );
    return { ...header.rows[0], lines: lines.rows };
  });
}
