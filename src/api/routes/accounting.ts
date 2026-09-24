import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import {
  createCustomerReceipt,
  postCustomerReceipt,
  createSupplierPayment,
  postSupplierPayment,
  createBankStatementLine,
  matchBankStatementLine,
  createAndPostBankReconciliation,
} from "../../accounting/accountingService.js";
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

const statementLineCreateSchema = z.object({
  bankAccountId: z.string().uuid(),
  statementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().optional(),
  amount: z.number().refine((v) => v !== 0, "amount cannot be zero"),
  reference: z.string().optional(),
});

const matchSchema = z.object({
  journalLineId: z.string().uuid(),
});

const reconciliationCreateSchema = z.object({
  bankAccountId: z.string().uuid(),
  statementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  statementEndingBalance: z.number(),
  statementLineIds: z.array(z.string().uuid()).min(1),
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

  // ---- Bank reconciliation ----
  // Statement lines are entered manually here (no bank feed/CSV import in
  // this phase), matched one-to-one against a posted journal_line on the
  // bank's own GL account, then swept into a posted reconciliation whose
  // running total must tie to the declared statement ending balance — the
  // documented simplification from migration 0041 (no outstanding-items
  // theory, e.g. deposits in transit).

  app.post(
    "/bank-statement-lines",
    { preHandler: [app.authenticate, app.requirePermission("accounting.journal.post")] },
    async (request, reply) => {
      const body = statementLineCreateSchema.parse(request.body);
      const id = await withTransaction(
        (client) =>
          createBankStatementLine(client, {
            companyId: request.companyId,
            bankAccountId: body.bankAccountId,
            statementDate: body.statementDate,
            description: body.description ?? null,
            amount: body.amount,
            reference: body.reference ?? null,
            createdBy: request.authUser.id,
          }),
        request.authUser.id,
      );
      reply.status(201);
      return { id };
    },
  );

  app.get("/bank-statement-lines", { preHandler: app.authenticate }, async (request) => {
    const query = z.object({ bankAccountId: z.string().uuid() }).parse(request.query);
    const result = await pool.query(
      `SELECT bsl.*, jl.description AS matched_description, j.journal_number AS matched_journal_number
       FROM bank_statement_lines bsl
       LEFT JOIN journal_lines jl ON jl.id = bsl.matched_journal_line_id
       LEFT JOIN journals j ON j.id = jl.journal_id
       WHERE bsl.company_id = $1 AND bsl.bank_account_id = $2
       ORDER BY bsl.statement_date DESC, bsl.created_at DESC`,
      [request.companyId, query.bankAccountId],
    );
    return result.rows;
  });

  app.post<{ Params: { id: string } }>(
    "/bank-statement-lines/:id/match",
    { preHandler: [app.authenticate, app.requirePermission("accounting.journal.post")] },
    async (request) => {
      const body = matchSchema.parse(request.body);
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM bank_statement_lines WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("statement line not found");
        await matchBankStatementLine(client, request.params.id, body.journalLineId);
      }, request.authUser.id);
      return { id: request.params.id, matched: true };
    },
  );

  // Candidates for matching: posted journal lines on this bank account's
  // own GL account that no statement line has claimed yet.
  app.get("/bank-accounts/:id/unmatched-journal-lines", { preHandler: app.authenticate }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await pool.query(
      `SELECT jl.id, jl.debit_amount, jl.credit_amount, jl.description, j.journal_number, j.journal_date
       FROM journal_lines jl
       JOIN journals j ON j.id = jl.journal_id
       JOIN bank_accounts ba ON ba.gl_account_id = jl.account_id
       WHERE ba.id = $1 AND j.company_id = $2 AND j.document_status = 'posted'
         AND NOT EXISTS (SELECT 1 FROM bank_statement_lines bsl WHERE bsl.matched_journal_line_id = jl.id)
       ORDER BY j.journal_date DESC`,
      [params.id, request.companyId],
    );
    return result.rows;
  });

  app.get("/bank-reconciliations", { preHandler: app.authenticate }, async (request) => {
    const query = z.object({ bankAccountId: z.string().uuid() }).parse(request.query);
    const result = await pool.query(
      `SELECT id, statement_date, statement_ending_balance, document_status,
              (SELECT COUNT(*) FROM bank_statement_lines WHERE bank_reconciliation_id = br.id) AS line_count
       FROM bank_reconciliations br
       WHERE company_id = $1 AND bank_account_id = $2
       ORDER BY statement_date DESC`,
      [request.companyId, query.bankAccountId],
    );
    return result.rows;
  });

  app.post(
    "/bank-reconciliations",
    { preHandler: [app.authenticate, app.requirePermission("accounting.journal.post")] },
    async (request, reply) => {
      const body = reconciliationCreateSchema.parse(request.body);
      const id = await withTransaction(
        (client) =>
          createAndPostBankReconciliation(
            client,
            {
              companyId: request.companyId,
              bankAccountId: body.bankAccountId,
              statementDate: body.statementDate,
              statementEndingBalance: body.statementEndingBalance,
              statementLineIds: body.statementLineIds,
              createdBy: request.authUser.id,
            },
            request.authUser.id,
          ),
        request.authUser.id,
      );
      reply.status(201);
      return { id };
    },
  );
}
