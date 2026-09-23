import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { createCustomerReceipt, postCustomerReceipt, createSupplierPayment, postSupplierPayment } from "../../accounting/accountingService.js";
import { NotFoundError } from "../errors.js";

const journalLineSchema = z.object({
  accountId: z.string().uuid(),
  debitAmount: z.number().nonnegative().default(0),
  creditAmount: z.number().nonnegative().default(0),
  description: z.string().optional(),
});

const journalCreateSchema = z.object({
  journalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fiscalPeriodId: z.string().uuid(),
  memo: z.string().optional(),
  lines: z.array(journalLineSchema).min(2), // a journal needs at least two lines to balance
});

const receiptCreateSchema = z.object({
  customerId: z.string().uuid(),
  bankAccountId: z.string().uuid().nullable().optional(),
  receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fiscalPeriodId: z.string().uuid(),
  paymentMethod: z.enum(["cash", "card", "credit", "points", "gift_card"]),
  amount: z.number().positive(),
  reference: z.string().optional(),
  allocations: z.array(z.object({ salesInvoiceId: z.string().uuid(), allocatedAmount: z.number().positive() })).optional(),
});

const paymentCreateSchema = z.object({
  supplierId: z.string().uuid(),
  bankAccountId: z.string().uuid().nullable().optional(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fiscalPeriodId: z.string().uuid(),
  paymentMethod: z.enum(["cash", "card", "credit", "points", "gift_card"]),
  amount: z.number().positive(),
  reference: z.string().optional(),
  allocations: z.array(z.object({ supplierInvoiceId: z.string().uuid(), allocatedAmount: z.number().positive() })).optional(),
});

export async function accountingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/chart-of-accounts", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, parent_id, account_code, name_en, name_ar, account_type, normal_balance, is_header, is_active
       FROM chart_of_accounts WHERE company_id = $1 ORDER BY account_code`,
      [request.companyId],
    );
    return result.rows;
  });

  app.get("/fiscal-periods", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT fp.id, fp.period_number, fp.start_date, fp.end_date, fp.status, fy.year_name
       FROM fiscal_periods fp JOIN fiscal_years fy ON fy.id = fp.fiscal_year_id
       WHERE fp.company_id = $1 ORDER BY fp.start_date`,
      [request.companyId],
    );
    return result.rows;
  });

  app.get("/bank-accounts", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, bank_name, account_name, account_number, iban, currency, is_active
       FROM bank_accounts WHERE company_id = $1 ORDER BY bank_name`,
      [request.companyId],
    );
    return result.rows;
  });

  // ---- Journals (general ledger) ----

  app.get("/journals", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, journal_number, journal_date, source_type, document_status
       FROM journals WHERE company_id = $1 ORDER BY journal_date DESC, created_at DESC LIMIT 200`,
      [request.companyId],
    );
    return result.rows;
  });

  app.get<{ Params: { id: string } }>("/journals/:id", { preHandler: app.authenticate }, async (request) => {
    const header = await pool.query(`SELECT * FROM journals WHERE id = $1 AND company_id = $2`, [
      request.params.id,
      request.companyId,
    ]);
    if (header.rows.length === 0) throw new NotFoundError("journal not found");
    const lines = await pool.query(
      `SELECT jl.*, coa.account_code, coa.name_en AS account_name_en, coa.name_ar AS account_name_ar
       FROM journal_lines jl JOIN chart_of_accounts coa ON coa.id = jl.account_id
       WHERE jl.journal_id = $1 ORDER BY jl.line_number`,
      [request.params.id],
    );
    return { ...header.rows[0], lines: lines.rows };
  });

  // Manual journal entry: unlike every other document in this system, a
  // manual journal has no upstream business document to derive its lines
  // from, so create + post happen in one call -- there's nothing draft-only
  // useful to inspect in between for a hand-entered GL line.
  app.post(
    "/journals",
    { preHandler: [app.authenticate, app.requirePermission("accounting.journal.post")] },
    async (request, reply) => {
      const body = journalCreateSchema.parse(request.body);
      const journalId = await withTransaction(async (client) => {
        const fiscalYear = Number(body.journalDate.slice(0, 4));
        const numberResult = await client.query<{ fn_next_document_number: string }>(
          `SELECT fn_next_document_number($1, 'journal', $2, 'GJ-') AS fn_next_document_number`,
          [request.companyId, fiscalYear],
        );
        const journalNumber = numberResult.rows[0]!.fn_next_document_number;

        const journal = await client.query<{ id: string }>(
          `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type, memo, created_by)
           VALUES ($1, $2, $3, $4, 'manual', $5, $6) RETURNING id`,
          [request.companyId, journalNumber, body.journalDate, body.fiscalPeriodId, body.memo ?? null, request.authUser.id],
        );
        const id = journal.rows[0]!.id;

        let lineNumber = 0;
        for (const line of body.lines) {
          lineNumber += 1;
          await client.query(
            `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, credit_amount, description)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [request.companyId, id, lineNumber, line.accountId, line.debitAmount, line.creditAmount, line.description ?? null],
          );
        }

        // trg_journals_guard (0019) validates balance + open period here.
        await client.query(`UPDATE journals SET document_status = 'posted', posted_by = $2 WHERE id = $1`, [id, request.authUser.id]);
        return id;
      }, request.authUser.id);
      reply.status(201);
      return { id: journalId };
    },
  );

  // ---- Customer receipts (AR settlement) ----

  app.get("/customer-receipts", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT cr.id, cr.document_number, cr.receipt_date, cr.payment_method, cr.amount, cr.document_status,
              c.name_en AS customer_name_en, c.name_ar AS customer_name_ar
       FROM customer_receipts cr JOIN customers c ON c.id = cr.customer_id
       WHERE cr.company_id = $1 ORDER BY cr.receipt_date DESC LIMIT 200`,
      [request.companyId],
    );
    return result.rows;
  });

  app.post(
    "/customer-receipts",
    { preHandler: [app.authenticate, app.requirePermission("accounting.journal.post")] },
    async (request, reply) => {
      const body = receiptCreateSchema.parse(request.body);
      const id = await withTransaction(async (client) => {
        const receiptId = await createCustomerReceipt(client, {
          companyId: request.companyId,
          customerId: body.customerId,
          bankAccountId: body.bankAccountId ?? null,
          receiptDate: body.receiptDate,
          fiscalPeriodId: body.fiscalPeriodId,
          paymentMethod: body.paymentMethod,
          amount: body.amount,
          reference: body.reference ?? null,
          createdBy: request.authUser.id,
          allocations: body.allocations,
        });
        await postCustomerReceipt(client, receiptId, request.authUser.id);
        return receiptId;
      }, request.authUser.id);
      reply.status(201);
      return { id };
    },
  );

  // ---- Supplier payments (AP settlement) ----

  app.get("/supplier-payments", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT sp.id, sp.document_number, sp.payment_date, sp.payment_method, sp.amount, sp.document_status,
              s.name_en AS supplier_name_en, s.name_ar AS supplier_name_ar
       FROM supplier_payments sp JOIN suppliers s ON s.id = sp.supplier_id
       WHERE sp.company_id = $1 ORDER BY sp.payment_date DESC LIMIT 200`,
      [request.companyId],
    );
    return result.rows;
  });

  app.post(
    "/supplier-payments",
    { preHandler: [app.authenticate, app.requirePermission("accounting.journal.post")] },
    async (request, reply) => {
      const body = paymentCreateSchema.parse(request.body);
      const id = await withTransaction(async (client) => {
        const paymentId = await createSupplierPayment(client, {
          companyId: request.companyId,
          supplierId: body.supplierId,
          bankAccountId: body.bankAccountId ?? null,
          paymentDate: body.paymentDate,
          fiscalPeriodId: body.fiscalPeriodId,
          paymentMethod: body.paymentMethod,
          amount: body.amount,
          reference: body.reference ?? null,
          createdBy: request.authUser.id,
          allocations: body.allocations,
        });
        await postSupplierPayment(client, paymentId, request.authUser.id);
        return paymentId;
      }, request.authUser.id);
      reply.status(201);
      return { id };
    },
  );

  // ---- Ageing ----

  app.get("/ar-ageing", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT ar.*, c.name_en AS customer_name_en, c.name_ar AS customer_name_ar
       FROM ar_ageing ar JOIN customers c ON c.id = ar.customer_id
       WHERE ar.company_id = $1 ORDER BY ar.due_date`,
      [request.companyId],
    );
    return result.rows;
  });

  app.get("/ap-ageing", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT ap.*, s.name_en AS supplier_name_en, s.name_ar AS supplier_name_ar
       FROM ap_ageing ap JOIN suppliers s ON s.id = ap.supplier_id
       WHERE ap.company_id = $1 ORDER BY ap.due_date`,
      [request.companyId],
    );
    return result.rows;
  });
}
