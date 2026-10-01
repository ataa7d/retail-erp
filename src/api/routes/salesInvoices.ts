import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { createSalesInvoice, postSalesInvoice, createCreditNote, postCreditNote } from "../../sales/salesService.js";
import { NotFoundError, BusinessRuleError } from "../errors.js";
import { bulkIdsSchema, runBulkAction } from "./bulkHelpers.js";
import { renderZatcaQrDataUrl } from "../../zatca/qrCode.js";
import { finalizeSalesInvoiceXmlHash, renderSalesInvoiceXml, finalizeCreditNoteXmlHash } from "../../zatca/invoiceXmlService.js";

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
  paymentMethod: z.enum(["cash", "card", "credit", "points", "gift_card", "deposit"]),
  amount: z.number().positive(),
  reference: z.string().optional(),
});

const voidSchema = z.object({
  fiscalPeriodId: z.string().uuid(),
  creditNoteDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().min(1),
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
              c.name_en AS customer_name_en, c.name_ar AS customer_name_ar,
              COALESCE((SELECT SUM(gross_amount) FROM credit_notes
                        WHERE original_invoice_id = si.id AND document_status = 'posted'), 0) AS credited_amount
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
        `SELECT si.*, c.name_en AS company_name_en, c.name_ar AS company_name_ar,
                c.vat_registration_number AS company_vat_number, c.cr_number AS company_cr_number,
                cust.name_en AS customer_name_en, cust.name_ar AS customer_name_ar,
                cust.vat_registration_number AS customer_vat_number
         FROM sales_invoices si
         JOIN companies c ON c.id = si.company_id
         LEFT JOIN customers cust ON cust.id = si.customer_id
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
      const credited = await pool.query<{ credited_amount: string }>(
        `SELECT COALESCE(SUM(gross_amount), 0) AS credited_amount FROM credit_notes
         WHERE original_invoice_id = $1 AND document_status = 'posted'`,
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

      return {
        ...invoice,
        lines: lines.rows,
        payments: payments.rows,
        zatcaQr,
        zatcaQrError,
        creditedAmount: credited.rows[0]!.credited_amount,
      };
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
        await finalizeSalesInvoiceXmlHash(client, request.params.id);
      }, request.authUser.id);

      return { id: request.params.id, status: "posted" };
    },
  );

  app.post(
    "/sales-invoices/bulk-post",
    { preHandler: [app.authenticate, app.requirePermission("sales.pos_invoice.create")] },
    async (request) => {
      const body = bulkIdsSchema.parse(request.body);
      const results = await runBulkAction(body.ids, "posted", (id) =>
        withTransaction(async (client) => {
          const existing = await client.query(`SELECT id FROM sales_invoices WHERE id = $1 AND company_id = $2`, [
            id,
            request.companyId,
          ]);
          if (existing.rows.length === 0) throw new NotFoundError("sales invoice not found");
          await postSalesInvoice(client, id, request.authUser.id);
          await finalizeSalesInvoiceXmlHash(client, id);
        }, request.authUser.id),
      );
      return { results };
    },
  );

  // Void a posted sale. ZATCA requires a submitted tax invoice to never be
  // altered or deleted -- "voiding" it is really just issuing a full credit
  // note against every line, immediately posted, under a permission that's
  // separate from a manual partial return (sales.document.void vs
  // sales.return.create). Restricted to invoices with no existing credit
  // notes so the "full void" and "partial return" flows can't collide --
  // an invoice that's already been partly returned should go through the
  // ordinary credit-note form instead.
  app.post<{ Params: { id: string } }>(
    "/sales-invoices/:id/void",
    { preHandler: [app.authenticate, app.requirePermission("sales.document.void")] },
    async (request, reply) => {
      const body = voidSchema.parse(request.body);

      const creditNoteId = await withTransaction(async (client) => {
        const invoice = await client.query(
          `SELECT id, store_id, document_status, zatca_invoice_category, customer_id, gross_amount
           FROM sales_invoices WHERE id = $1 AND company_id = $2`,
          [request.params.id, request.companyId],
        );
        if (invoice.rows.length === 0) throw new NotFoundError("sales invoice not found");
        const inv = invoice.rows[0]!;
        if (inv.document_status !== "posted") {
          throw new BusinessRuleError("only a posted invoice can be voided");
        }

        const existingCredits = await client.query(
          `SELECT COALESCE(SUM(gross_amount), 0) AS total FROM credit_notes
           WHERE original_invoice_id = $1 AND document_status = 'posted'`,
          [request.params.id],
        );
        if (Number(existingCredits.rows[0]!.total) > 0) {
          throw new BusinessRuleError(
            "this invoice already has a credit note against it; use the Credit Notes form for a partial return instead",
          );
        }

        const lines = await client.query(
          `SELECT id, item_variant_id, item_description, qty, unit_price, discount_amount, vat_rate, price_includes_vat
           FROM sales_invoice_lines WHERE invoice_id = $1 ORDER BY line_number`,
          [request.params.id],
        );

        const id = await createCreditNote(client, {
          companyId: request.companyId,
          storeId: inv.store_id,
          originalInvoiceId: request.params.id,
          zatcaInvoiceCategory: inv.zatca_invoice_category,
          creditNoteDate: body.creditNoteDate ?? new Date().toISOString().slice(0, 10),
          fiscalPeriodId: body.fiscalPeriodId,
          customerId: inv.customer_id,
          reason: `Voided: ${body.reason}`,
          createdBy: request.authUser.id,
          lines: lines.rows.map((l) => ({
            sourceLineId: l.id,
            itemVariantId: l.item_variant_id,
            itemDescription: l.item_description,
            qty: Number(l.qty),
            unitPrice: Number(l.unit_price),
            discountAmount: Number(l.discount_amount),
            vatRate: Number(l.vat_rate),
            priceIncludesVat: l.price_includes_vat,
          })),
        });
        await postCreditNote(client, id, request.authUser.id);
        await finalizeCreditNoteXmlHash(client, id);
        return id;
      }, request.authUser.id);

      reply.status(201);
      return { creditNoteId, status: "posted" };
    },
  );

  // ZATCA Phase 2 XML export -- see src/zatca/ublXml.ts for the scope
  // boundary (structurally correct, unsigned; not a certified submission).
  app.get<{ Params: { id: string } }>("/sales-invoices/:id/xml", { preHandler: app.authenticate }, async (request, reply) => {
    const existing = await pool.query(`SELECT document_number FROM sales_invoices WHERE id = $1 AND company_id = $2`, [
      request.params.id,
      request.companyId,
    ]);
    if (existing.rows.length === 0) throw new NotFoundError("sales invoice not found");

    const xml = await renderSalesInvoiceXml(pool, request.params.id, request.companyId);
    if (!xml) throw new NotFoundError("this invoice has no XML export yet (only posted invoices have one)");

    reply
      .header("Content-Type", "application/xml; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${existing.rows[0]!.document_number}.xml"`);
    return xml;
  });
}
