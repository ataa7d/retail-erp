import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { issueGiftCard } from "../../sales/giftCardService.js";
import { NotFoundError } from "../errors.js";

const issueSchema = z.object({
  storeId: z.string().uuid(),
  cardNumber: z.string().min(1),
  initialValue: z.number().positive(),
  paymentMethod: z.enum(["cash", "card"]),
  customerId: z.string().uuid().nullable().optional(),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  fiscalPeriodId: z.string().uuid(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function giftCardRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/gift-cards",
    { preHandler: [app.authenticate, app.requirePermission("sales.gift_card.issue")] },
    async (request, reply) => {
      const body = issueSchema.parse(request.body);
      const id = await withTransaction(
        (client) =>
          issueGiftCard(client, {
            companyId: request.companyId,
            storeId: body.storeId,
            cardNumber: body.cardNumber,
            initialValue: body.initialValue,
            paymentMethod: body.paymentMethod,
            customerId: body.customerId ?? null,
            expiresAt: body.expiresAt ?? null,
            fiscalPeriodId: body.fiscalPeriodId,
            issueDate: body.issueDate,
            issuedBy: request.authUser.id,
          }),
        request.authUser.id,
      );
      reply.status(201);
      return { id };
    },
  );

  app.get("/gift-cards", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT gc.id, gc.card_number, gc.initial_value, gc.balance, gc.status, gc.issued_at, gc.expires_at,
              s.name_en AS store_name_en, c.name_en AS customer_name_en, c.name_ar AS customer_name_ar
       FROM gift_cards gc
       JOIN stores s ON s.id = gc.store_id
       LEFT JOIN customers c ON c.id = gc.customer_id
       WHERE gc.company_id = $1
       ORDER BY gc.issued_at DESC
       LIMIT 200`,
      [request.companyId],
    );
    return result.rows;
  });

  // Balance lookup by card number -- what the POS tender screen calls
  // before accepting a gift card payment, so the cashier sees the
  // available balance before ringing it up (the actual redemption/debit
  // only happens later, at invoice post time).
  app.get<{ Querystring: { cardNumber: string } }>("/gift-cards/lookup", { preHandler: app.authenticate }, async (request) => {
    const query = z.object({ cardNumber: z.string().min(1) }).parse(request.query);
    const result = await pool.query(
      `SELECT id, card_number, balance, status FROM gift_cards WHERE company_id = $1 AND card_number = $2`,
      [request.companyId, query.cardNumber],
    );
    if (result.rows.length === 0) throw new NotFoundError("no gift card found with that number");
    return result.rows[0];
  });

  app.get<{ Params: { id: string } }>("/gift-cards/:id", { preHandler: app.authenticate }, async (request) => {
    const header = await pool.query(
      `SELECT gc.*, s.name_en AS store_name_en, c.name_en AS customer_name_en, c.name_ar AS customer_name_ar
       FROM gift_cards gc
       JOIN stores s ON s.id = gc.store_id
       LEFT JOIN customers c ON c.id = gc.customer_id
       WHERE gc.id = $1 AND gc.company_id = $2`,
      [request.params.id, request.companyId],
    );
    if (header.rows.length === 0) throw new NotFoundError("gift card not found");

    const transactions = await pool.query(
      `SELECT gct.*, si.document_number AS sales_invoice_number
       FROM gift_card_transactions gct
       LEFT JOIN sales_invoices si ON si.id = gct.sales_invoice_id
       WHERE gct.gift_card_id = $1
       ORDER BY gct.created_at`,
      [request.params.id],
    );
    return { ...header.rows[0], transactions: transactions.rows };
  });
}
