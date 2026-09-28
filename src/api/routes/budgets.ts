import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { NotFoundError, BusinessRuleError } from "../errors.js";

const createSchema = z.object({
  fiscalYearId: z.string().uuid(),
  name: z.string().min(1),
});

const lineSchema = z.object({
  fiscalPeriodId: z.string().uuid(),
  accountId: z.string().uuid(),
  amount: z.number().nonnegative(),
});

export async function budgetRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/budgets",
    { preHandler: [app.authenticate, app.requirePermission("accounting.budget.manage")] },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      const id = await withTransaction(async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO budgets (company_id, fiscal_year_id, name, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
          [request.companyId, body.fiscalYearId, body.name, request.authUser.id],
        );
        return result.rows[0]!.id;
      }, request.authUser.id);
      reply.status(201);
      return { id };
    },
  );

  app.get("/budgets", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT b.id, b.name, b.status, b.created_at, fy.year_name,
              u.email AS created_by_email,
              (SELECT COUNT(*) FROM budget_lines WHERE budget_id = b.id) AS line_count
       FROM budgets b
       JOIN fiscal_years fy ON fy.id = b.fiscal_year_id
       LEFT JOIN users u ON u.id = b.created_by
       WHERE b.company_id = $1
       ORDER BY fy.start_date DESC, b.name`,
      [request.companyId],
    );
    return result.rows;
  });

  app.get<{ Params: { id: string } }>("/budgets/:id", { preHandler: app.authenticate }, async (request) => {
    const header = await pool.query(
      `SELECT b.*, fy.year_name FROM budgets b JOIN fiscal_years fy ON fy.id = b.fiscal_year_id
       WHERE b.id = $1 AND b.company_id = $2`,
      [request.params.id, request.companyId],
    );
    if (header.rows.length === 0) throw new NotFoundError("budget not found");

    const lines = await pool.query(
      `SELECT bl.id, bl.fiscal_period_id, bl.account_id, bl.amount,
              fp.period_number, coa.account_code, coa.name_en AS account_name_en
       FROM budget_lines bl
       JOIN fiscal_periods fp ON fp.id = bl.fiscal_period_id
       JOIN chart_of_accounts coa ON coa.id = bl.account_id
       WHERE bl.budget_id = $1
       ORDER BY fp.period_number, coa.account_code`,
      [request.params.id],
    );
    return { ...header.rows[0], lines: lines.rows };
  });

  app.post<{ Params: { id: string } }>(
    "/budgets/:id/status",
    { preHandler: [app.authenticate, app.requirePermission("accounting.budget.manage")] },
    async (request) => {
      const body = z.object({ status: z.enum(["draft", "approved"]) }).parse(request.body);
      const existing = await pool.query(`SELECT id FROM budgets WHERE id = $1 AND company_id = $2`, [
        request.params.id,
        request.companyId,
      ]);
      if (existing.rows.length === 0) throw new NotFoundError("budget not found");
      await pool.query(`UPDATE budgets SET status = $2 WHERE id = $1`, [request.params.id, body.status]);
      return { id: request.params.id, status: body.status };
    },
  );

  // Upsert one budget line at a time -- edited from the UI as a grid
  // (period x account), same pattern as a price list's per-variant price.
  app.post<{ Params: { id: string } }>(
    "/budgets/:id/lines",
    { preHandler: [app.authenticate, app.requirePermission("accounting.budget.manage")] },
    async (request, reply) => {
      const body = lineSchema.parse(request.body);
      await withTransaction(async (client) => {
        const budget = await client.query(`SELECT id, status FROM budgets WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (budget.rows.length === 0) throw new NotFoundError("budget not found");
        if (budget.rows[0]!.status === "approved") {
          throw new BusinessRuleError("this budget is approved; reopen it to draft before changing amounts");
        }

        await client.query(
          `INSERT INTO budget_lines (company_id, budget_id, fiscal_period_id, account_id, amount)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (budget_id, fiscal_period_id, account_id) DO UPDATE SET amount = EXCLUDED.amount`,
          [request.companyId, request.params.id, body.fiscalPeriodId, body.accountId, body.amount],
        );
      }, request.authUser.id);
      reply.status(200);
      return { fiscalPeriodId: body.fiscalPeriodId, accountId: body.accountId, amount: body.amount };
    },
  );
}
