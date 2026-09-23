import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { createPayrollRun, postPayrollRun } from "../../hr/payrollService.js";
import { NotFoundError } from "../errors.js";

const createSchema = z.object({
  fiscalPeriodId: z.string().uuid(),
  payPeriodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payPeriodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  runDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function payrollRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/payroll-runs",
    { preHandler: [app.authenticate, app.requirePermission("hr.payroll.post")] },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      const id = await withTransaction(
        (client) =>
          createPayrollRun(client, {
            companyId: request.companyId,
            fiscalPeriodId: body.fiscalPeriodId,
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
    const lines = await pool.query(`SELECT * FROM payroll_run_lines WHERE payroll_run_id = $1`, [request.params.id]);
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
}
