import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { createPayrollRun, postPayrollRun } from "../../hr/payrollService.js";
import { NotFoundError } from "../errors.js";
import { bulkIdsSchema, runBulkAction } from "./bulkHelpers.js";
import { resolveFiscalPeriodId } from "../../accounting/fiscalPeriods.js";

const createSchema = z.object({
  payPeriodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payPeriodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  runDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function payrollRoutes(app: FastifyInstance): Promise<void> {
  app.get("/payroll-runs", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, document_number, pay_period_start, pay_period_end, run_date, document_status
       FROM payroll_runs WHERE company_id = $1 ORDER BY run_date DESC`,
      [request.companyId],
    );
    return result.rows;
  });

  app.post(
    "/payroll-runs",
    { preHandler: [app.authenticate, app.requirePermission("hr.payroll.post")] },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      const id = await withTransaction(
        async (client) =>
          createPayrollRun(client, {
            companyId: request.companyId,
            fiscalPeriodId: await resolveFiscalPeriodId(client, request.companyId, body.runDate),
            payPeriodStart: body.payPeriodStart,
            payPeriodEnd: body.payPeriodEnd,
            runDate: body.runDate,
            createdBy: request.authUser.id,
          }),
        request.authUser.id,
      );
      reply.status(201);
      return { id };
    },
  );

  app.get<{ Params: { id: string } }>("/payroll-runs/:id", { preHandler: app.authenticate }, async (request) => {
    const header = await pool.query(`SELECT * FROM payroll_runs WHERE id = $1 AND company_id = $2`, [
      request.params.id,
      request.companyId,
    ]);
    if (header.rows.length === 0) throw new NotFoundError("payroll run not found");
    // Joined with the employee for display/payslip purposes -- the raw
    // line itself only carries employee_id, everything else here is what a
    // payslip or a review screen needs to actually show who this is.
    const lines = await pool.query(
      `SELECT prl.*, e.employee_code, e.full_name_en, e.full_name_ar, e.national_id
       FROM payroll_run_lines prl
       JOIN employees e ON e.id = prl.employee_id
       WHERE prl.payroll_run_id = $1
       ORDER BY e.employee_code`,
      [request.params.id],
    );
    return { ...header.rows[0], lines: lines.rows };
  });

  app.post<{ Params: { id: string } }>(
    "/payroll-runs/:id/post",
    { preHandler: [app.authenticate, app.requirePermission("hr.payroll.post")] },
    async (request) => {
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM payroll_runs WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("payroll run not found");
        await postPayrollRun(client, request.params.id, request.authUser.id);
      }, request.authUser.id);
      return { id: request.params.id, status: "posted" };
    },
  );

  app.post(
    "/payroll-runs/bulk-post",
    { preHandler: [app.authenticate, app.requirePermission("hr.payroll.post")] },
    async (request) => {
      const body = bulkIdsSchema.parse(request.body);
      const results = await runBulkAction(body.ids, "posted", (id) =>
        withTransaction(async (client) => {
          const existing = await client.query(`SELECT id FROM payroll_runs WHERE id = $1 AND company_id = $2`, [
            id,
            request.companyId,
          ]);
          if (existing.rows.length === 0) throw new NotFoundError("payroll run not found");
          await postPayrollRun(client, id, request.authUser.id);
        }, request.authUser.id),
      );
      return { results };
    },
  );
}
