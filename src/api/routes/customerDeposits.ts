import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { recordCustomerDeposit } from "../../sales/customerDepositService.js";
import { NotFoundError } from "../errors.js";

const recordSchema = z.object({
  storeId: z.string().uuid(),
  customerId: z.string().uuid(),
  amount: z.number().positive(),
  paymentMethod: z.enum(["cash", "card"]),
  reference: z.string().nullable().optional(),
  fiscalPeriodId: z.string().uuid(),
  depositDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function customerDepositRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/customer-deposits",
    { preHandler: [app.authenticate, app.requirePermission("sales.deposit.record")] },
    async (request, reply) => {
      const body = recordSchema.parse(request.body);
      const id = await withTransaction(
        (client) =>
          recordCustomerDeposit(client, {
            companyId: request.companyId,
            storeId: body.storeId,
            customerId: body.customerId,
            amount: body.amount,
            paymentMethod: body.paymentMethod,
            reference: body.reference ?? null,
            fiscalPeriodId: body.fiscalPeriodId,
            depositDate: body.depositDate,
            recordedBy: request.authUser.id,
          }),
        request.authUser.id,
      );
      reply.status(201);
      return { id };
    },
  );

  app.get<{ Querystring: { customerId?: string } }>("/customer-deposits", { preHandler: app.authenticate }, async (request) => {
    const query = z.object({ customerId: z.string().uuid().optional() }).parse(request.query);
    const result = await pool.query(
      `SELECT cd.id, cd.document_number, cd.reference, cd.initial_value, cd.balance, cd.status, cd.deposit_date,
              s.name_en AS store_name_en, c.name_en AS customer_name_en, c.name_ar AS customer_name_ar
       FROM customer_deposits cd
       JOIN stores s ON s.id = cd.store_id
       JOIN customers c ON c.id = cd.customer_id
       WHERE cd.company_id = $1 AND ($2::uuid IS NULL OR cd.customer_id = $2)
       ORDER BY cd.deposit_date DESC
       LIMIT 200`,
      [request.companyId, query.customerId ?? null],
    );
    return result.rows;
  });

  // Balance lookup by document number + customer -- what the POS/Sales
  // tender screen calls before accepting a deposit as payment, so the
  // cashier sees the available balance (and confirms it's this customer's
  // deposit) before ringing it up. The actual application/debit only
  // happens later, at invoice post time.
  app.get<{ Querystring: { documentNumber: string; customerId: string } }>(
    "/customer-deposits/lookup",
    { preHandler: app.authenticate },
    async (request) => {
      const query = z.object({ documentNumber: z.string().min(1), customerId: z.string().uuid() }).parse(request.query);
      const result = await pool.query(
        `SELECT id, document_number, customer_id, balance, status FROM customer_deposits
         WHERE company_id = $1 AND document_number = $2`,
        [request.companyId, query.documentNumber],
      );
      if (result.rows.length === 0) throw new NotFoundError("no customer deposit found with that number");
      if (result.rows[0].customer_id !== query.customerId) {
        throw new NotFoundError("that deposit does not belong to this customer");
      }
      return result.rows[0];
    },
  );

  app.get<{ Params: { id: string } }>("/customer-deposits/:id", { preHandler: app.authenticate }, async (request) => {
    const header = await pool.query(
      `SELECT cd.*, s.name_en AS store_name_en, c.name_en AS customer_name_en, c.name_ar AS customer_name_ar
       FROM customer_deposits cd
       JOIN stores s ON s.id = cd.store_id
       JOIN customers c ON c.id = cd.customer_id
       WHERE cd.id = $1 AND cd.company_id = $2`,
      [request.params.id, request.companyId],
    );
    if (header.rows.length === 0) throw new NotFoundError("customer deposit not found");

    const transactions = await pool.query(
      `SELECT cdt.*, si.document_number AS sales_invoice_number
       FROM customer_deposit_transactions cdt
       LEFT JOIN sales_invoices si ON si.id = cdt.sales_invoice_id
       WHERE cdt.customer_deposit_id = $1
       ORDER BY cdt.created_at`,
      [request.params.id],
    );
    return { ...header.rows[0], transactions: transactions.rows };
  });
}
