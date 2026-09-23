import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

const asOfSchema = z.object({ asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const rangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/reports/trial-balance",
    { preHandler: [app.authenticate, app.requirePermission("accounting.reports.view")] },
    async (request) => {
      const query = asOfSchema.parse(request.query);
      const result = await pool.query(`SELECT * FROM fn_trial_balance($1, $2)`, [request.companyId, query.asOfDate]);
      return { asOfDate: query.asOfDate, rows: result.rows };
    },
  );

  app.get(
    "/reports/income-statement",
    { preHandler: [app.authenticate, app.requirePermission("accounting.reports.view")] },
    async (request) => {
      const query = rangeSchema.parse(request.query);
      const result = await pool.query(`SELECT * FROM fn_income_statement($1, $2, $3)`, [
        request.companyId,
        query.startDate,
        query.endDate,
      ]);
      return { startDate: query.startDate, endDate: query.endDate, rows: result.rows };
    },
  );

  app.get(
    "/reports/balance-sheet",
    { preHandler: [app.authenticate, app.requirePermission("accounting.reports.view")] },
    async (request) => {
      const query = asOfSchema.parse(request.query);
      const result = await pool.query(`SELECT * FROM fn_balance_sheet($1, $2)`, [request.companyId, query.asOfDate]);
      return { asOfDate: query.asOfDate, rows: result.rows };
    },
  );
}
