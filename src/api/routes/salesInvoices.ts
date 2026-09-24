import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { createSalesInvoice, postSalesInvoice } from "../../sales/salesService.js";
import { NotFoundError } from "../errors.js";
import { renderZatcaQrDataUrl } from "../../zatca/qrCode.js";

const lineSchema = z.object({
  itemVariantId: z.string().uuid().nullable(),
  itemDescription: z.string().min(1),
  lineType: z.enum(["item", "charge"]).optional(),
  qty: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discountAmount: z.number().nonnegative().default(0),
  vatRate: z.number().nonnegative(),
  priceIncludesVat: z.boolean(),
});

const paymentSchema = z.object({
  paymentMethod: z.enum(["cash", "card", "credit", "points", "gift_card"]),
  amount: z.number().positive(),
  reference: z.string().optional(),
});

const createSchema = z.object({
  storeId: z.string().uuid(),
  invoiceChannel: z.enum(["pos", "wholesale"]),
  zatcaInvoiceCategory: z.enum(["simplified", "standard"]),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fiscalPeriodId: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional(),
  salespersonId: z.string().uuid().nullable().optional(),
  priceListId: z.string().uuid().nullable().optional(),
  lines: z.array(lineSchema).min(1),
  payments: z.array(paymentSchema).optional(),
});

export async function salesInvoiceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/sales-invoices", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT si.id, si.document_number, si.invoice_channel, si.invoice_date, si.document_status,
              si.net_amount, si.vat_amount, si.gross_amount,
              c.name_en AS customer_name_en, c.name_ar AS customer_name_ar
       FROM sales_invoices si
       LEFT JOIN customers c ON c.id = si.customer_id
       WHERE si.company_id = $1
       ORDER BY si.invoice_date DESC, si.created_at DESC
       LIMIT 200`,
      [request.companyId],
    );
    return result.rows;
  });

  app.post(
    "/sales-invoices",
    { preHandler: [app.authenticate, app.requirePermission("sales.pos_invoice.create")] },
    async (request, reply) => {
      const body = createSchema.parse(request.body);

      const invoiceId = await withTransaction(async (client) => {
        return createSalesInvoice(client, {
          companyId: request.companyId,
          storeId: body.storeId,
          invoiceChannel: body.invoiceChannel,
          zatcaInvoiceCategory: body.zatcaInvoiceCategory,
          invoiceDate: body.invoiceDate,
          fiscalPeriodId: body.fiscalPeriodId,
          customerId: body.customerId ?? null,
          salespersonId: body.salespersonId ?? null,
          priceListId: body.priceListId ?? null,
          createdBy: request.authUser.id,
          lines: body.lines,
          payments: body.payments,
        });
      }, request.authUser.id);

      reply.status(201);
      return { id: invoiceId };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/sales-invoices/:id",
    { preHandler: app.authenticate },
    async (request) => {
      const header = await pool.query(
        `SELECT si.*, c.name_en AS company_name_en, c.vat_registration_number AS company_vat_number
         FROM sales_invoices si JOIN companies c ON c.id = si.company_id
         WHERE si.id = $1 AND si.company_id = $2`,
        [request.params.id, request.companyId],
      );
      if (header.rows.length === 0) throw new NotFoundError("sales invoice not found");
      const invoice = header.rows[0];

      const lines = await pool.query(
        `SELECT * FROM sales_invoice_lines WHERE invoice_id = $1 ORDER BY line_number`,
        [request.params.id],
      );
      const payments = await pool.query(
        `SELECT * FROM sales_invoice_payments WHERE invoice_id = $1`,
        [request.params.id],
      );

      // ZATCA Phase 1: every posted tax invoice carries this QR. A draft has
      // no posted_at yet (and may still change), so it gets none. A missing
      // or malformed company VAT number is a setup problem, not a reason to
      // 500 the whole invoice -- the invoice still loads, just without a QR.
      let zatcaQr: string | null = null;
      let zatcaQrError: string | null = null;
      if (invoice.document_status === "posted") {
        try {
          zatcaQr = await renderZatcaQrDataUrl({
            sellerName: invoice.company_name_en,
            vatRegistrationNumber: invoice.company_vat_number ?? "",
            timestamp: new Date(invoice.posted_at).toISOString(),
            invoiceTotal: Number(invoice.gross_amount),
            vatTotal: Number(invoice.vat_amount),
          });
        } catch (err) {
          zatcaQrError = err instanceof Error ? err.message : "failed to generate ZATCA QR code";
        }
      }

      return { ...invoice, lines: lines.rows, payments: payments.rows, zatcaQr, zatcaQrError };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/sales-invoices/:id/post",
    { preHandler: [app.authenticate, app.requirePermission("sales.pos_invoice.create")] },
    async (request) => {
      await withTransaction(async (client) => {
        const existing = await client.query(
          `SELECT id FROM sales_invoices WHERE id = $1 AND company_id = $2`,
          [request.params.id, request.companyId],
        );
        if (existing.rows.length === 0) throw new NotFoundError("sales invoice not found");

        await postSalesInvoice(client, request.params.id, request.authUser.id);
      }, request.authUser.id);

      return { id: request.params.id, status: "posted" };
    },
  );
}
