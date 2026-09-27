import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

const asOfSchema = z.object({ asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const rangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const customerStatementSchema = z.object({
  customerId: z.string().uuid(),
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

  // fn_customer_statement returns the customer's full posted AR history up
  // to endDate with a running balance -- the opening balance for the
  // requested period is just the running balance of the last transaction
  // before startDate (0 if there isn't one), same idea as how
  // fn_balance_sheet is called at two different as-of dates to derive a
  // period elsewhere in this app.
  app.get(
    "/reports/customer-statement",
    { preHandler: [app.authenticate, app.requirePermission("accounting.reports.view")] },
    async (request) => {
      const query = customerStatementSchema.parse(request.query);
      const result = await pool.query<{
        txn_date: Date;
        document_type: string;
        document_number: string;
        description: string;
        debit: string;
        credit: string;
        running_balance: string;
      }>(`SELECT * FROM fn_customer_statement($1, $2, $3)`, [request.companyId, query.customerId, query.endDate]);

      // pg parses a DATE column as a JS Date -- comparing it directly against
      // the "YYYY-MM-DD" query string would coerce through Date.toString(),
      // not the calendar value, so it's normalized to an ISO date string first.
      const isoDate = (d: Date) => d.toISOString().slice(0, 10);
      const before = result.rows.filter((r) => isoDate(r.txn_date) < query.startDate);
      const inRange = result.rows.filter((r) => isoDate(r.txn_date) >= query.startDate);
      const openingBalance = before.length > 0 ? before[before.length - 1]!.running_balance : "0.00";
      const closingBalance = result.rows.length > 0 ? result.rows[result.rows.length - 1]!.running_balance : openingBalance;

      return {
        customerId: query.customerId,
        startDate: query.startDate,
        endDate: query.endDate,
        openingBalance,
        closingBalance,
        rows: inRange,
      };
    },
  );
}
