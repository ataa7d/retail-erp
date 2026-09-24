import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { createCreditNote, postCreditNote } from "../../sales/salesService.js";
import { NotFoundError } from "../errors.js";
import { renderZatcaQrDataUrl } from "../../zatca/qrCode.js";
import { finalizeCreditNoteXmlHash, renderCreditNoteXml } from "../../zatca/invoiceXmlService.js";

const lineSchema = z.object({
  sourceLineId: z.string().uuid(),
  itemVariantId: z.string().uuid().nullable(),
  itemDescription: z.string().min(1),
  qty: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discountAmount: z.number().nonnegative().default(0),
  vatRate: z.number().nonnegative(),
  priceIncludesVat: z.boolean(),
});

const createSchema = z.object({
  storeId: z.string().uuid(),
  originalInvoiceId: z.string().uuid(),
  zatcaInvoiceCategory: z.enum(["simplified", "standard"]),
  creditNoteDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fiscalPeriodId: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional(),
  reason: z.string().min(1),
  lines: z.array(lineSchema).min(1),
});

export async function creditNoteRoutes(app: FastifyInstance): Promise<void> {
  app.get("/credit-notes", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT cn.id, cn.document_number, cn.credit_note_date, cn.document_status, cn.reason,
              cn.net_amount, cn.vat_amount, cn.gross_amount, cn.original_invoice_id,
              si.document_number AS original_invoice_number,
              c.name_en AS customer_name_en, c.name_ar AS customer_name_ar
       FROM credit_notes cn
       JOIN sales_invoices si ON si.id = cn.original_invoice_id
       LEFT JOIN customers c ON c.id = cn.customer_id
       WHERE cn.company_id = $1
       ORDER BY cn.credit_note_date DESC, cn.created_at DESC
       LIMIT 200`,
      [request.companyId],
    );
    return result.rows;
  });

  app.post(
    "/credit-notes",
    { preHandler: [app.authenticate, app.requirePermission("sales.return.create")] },
    async (request, reply) => {
      const body = createSchema.parse(request.body);

      const creditNoteId = await withTransaction(async (client) => {
        return createCreditNote(client, {
          companyId: request.companyId,
          storeId: body.storeId,
          originalInvoiceId: body.originalInvoiceId,
          zatcaInvoiceCategory: body.zatcaInvoiceCategory,
          creditNoteDate: body.creditNoteDate,
          fiscalPeriodId: body.fiscalPeriodId,
          customerId: body.customerId ?? null,
          reason: body.reason,
          createdBy: request.authUser.id,
          lines: body.lines,
        });
      }, request.authUser.id);

      reply.status(201);
      return { id: creditNoteId };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/credit-notes/:id",
    { preHandler: app.authenticate },
    async (request) => {
      const header = await pool.query(
        `SELECT cn.*, c.name_en AS company_name_en, c.vat_registration_number AS company_vat_number
         FROM credit_notes cn JOIN companies c ON c.id = cn.company_id
         WHERE cn.id = $1 AND cn.company_id = $2`,
        [request.params.id, request.companyId],
      );
      if (header.rows.length === 0) throw new NotFoundError("credit note not found");
      const creditNote = header.rows[0];

      const lines = await pool.query(
        `SELECT * FROM credit_note_lines WHERE credit_note_id = $1 ORDER BY line_number`,
        [request.params.id],
      );

      // Same ZATCA Phase 1 QR as sales invoices -- see that route for the
      // reasoning (draft has no posted_at; a bad company VAT number
      // degrades to no QR rather than a 500).
      let zatcaQr: string | null = null;
      let zatcaQrError: string | null = null;
      if (creditNote.document_status === "posted") {
        try {
          zatcaQr = await renderZatcaQrDataUrl({
            sellerName: creditNote.company_name_en,
            vatRegistrationNumber: creditNote.company_vat_number ?? "",
            timestamp: new Date(creditNote.posted_at).toISOString(),
            invoiceTotal: Number(creditNote.gross_amount),
            vatTotal: Number(creditNote.vat_amount),
          });
        } catch (err) {
          zatcaQrError = err instanceof Error ? err.message : "failed to generate ZATCA QR code";
        }
      }

      return { ...creditNote, lines: lines.rows, zatcaQr, zatcaQrError };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/credit-notes/:id/post",
    { preHandler: [app.authenticate, app.requirePermission("sales.return.create")] },
    async (request) => {
      await withTransaction(async (client) => {
        const existing = await client.query(
          `SELECT id FROM credit_notes WHERE id = $1 AND company_id = $2`,
          [request.params.id, request.companyId],
        );
        if (existing.rows.length === 0) throw new NotFoundError("credit note not found");

        await postCreditNote(client, request.params.id, request.authUser.id);
        await finalizeCreditNoteXmlHash(client, request.params.id);
      }, request.authUser.id);

      return { id: request.params.id, status: "posted" };
    },
  );

  // ZATCA Phase 2 XML export -- see src/zatca/ublXml.ts for the scope
  // boundary (structurally correct, unsigned; not a certified submission).
  app.get<{ Params: { id: string } }>("/credit-notes/:id/xml", { preHandler: app.authenticate }, async (request, reply) => {
    const existing = await pool.query(`SELECT document_number FROM credit_notes WHERE id = $1 AND company_id = $2`, [
      request.params.id,
      request.companyId,
    ]);
    if (existing.rows.length === 0) throw new NotFoundError("credit note not found");

    const xml = await renderCreditNoteXml(pool, request.params.id, request.companyId);
    if (!xml) throw new NotFoundError("this credit note has no XML export yet (only posted credit notes have one)");

    reply
      .header("Content-Type", "application/xml; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${existing.rows[0]!.document_number}.xml"`);
    return xml;
  });
}
