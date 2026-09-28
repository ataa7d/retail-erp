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
const stockValuationSchema = z.object({
  storeId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
});
const budgetVsActualSchema = z.object({
  budgetId: z.string().uuid(),
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

  // stock_balances already carries a running weighted-average cost and
  // total_value per store+variant (migration 0025) -- unlike the GL-based
  // reports above, this is a live snapshot, not a point-in-time
  // reconstruction, so it's a plain filtered query rather than a stored
  // fn_* function.
  app.get(
    "/reports/stock-valuation",
    { preHandler: [app.authenticate, app.requirePermission("accounting.reports.view")] },
    async (request) => {
      const query = stockValuationSchema.parse(request.query);
      const result = await pool.query(
        `SELECT sb.store_id, s.name_en AS store_name_en, s.name_ar AS store_name_ar,
                sb.item_variant_id, iv.variant_code, iv.color, iv.size,
                i.item_code, i.name_en AS item_name_en, i.name_ar AS item_name_ar,
                ig.name_en AS group_name_en,
                sb.qty_on_hand, sb.avg_unit_cost, sb.total_value
         FROM stock_balances sb
         JOIN stores s ON s.id = sb.store_id
         JOIN item_variants iv ON iv.id = sb.item_variant_id
         JOIN items i ON i.id = iv.item_id
         LEFT JOIN item_groups ig ON ig.id = i.group_id
         WHERE sb.company_id = $1 AND sb.qty_on_hand <> 0
           AND ($2::uuid IS NULL OR sb.store_id = $2)
           AND ($3::uuid IS NULL OR i.group_id = $3)
         ORDER BY s.name_en, i.item_code, iv.variant_code`,
        [request.companyId, query.storeId ?? null, query.groupId ?? null],
      );
      const totalValue = result.rows.reduce((sum, r) => sum + Number(r.total_value), 0);
      return { totalValue: totalValue.toFixed(2), rows: result.rows };
    },
  );

  app.get(
    "/reports/budget-vs-actual",
    { preHandler: [app.authenticate, app.requirePermission("accounting.reports.view")] },
    async (request) => {
      const query = budgetVsActualSchema.parse(request.query);
      const result = await pool.query(`SELECT * FROM fn_budget_vs_actual($1, $2, $3, $4)`, [
        request.companyId,
        query.budgetId,
        query.startDate,
        query.endDate,
      ]);
      return { budgetId: query.budgetId, startDate: query.startDate, endDate: query.endDate, rows: result.rows };
    },
  );
}
