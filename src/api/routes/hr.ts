import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { createDepartment, createPosition, createEmployee, terminateEmployee } from "../../hr/hrService.js";
import { NotFoundError } from "../errors.js";

const departmentSchema = z.object({ code: z.string().min(1), nameEn: z.string().min(1), nameAr: z.string().min(1) });
const positionSchema = z.object({ code: z.string().min(1), nameEn: z.string().min(1), nameAr: z.string().min(1) });

const employeeSchema = z.object({
  departmentId: z.string().uuid().nullable().optional(),
  positionId: z.string().uuid().nullable().optional(),
  storeId: z.string().uuid().nullable().optional(),
  employeeCode: z.string().min(1),
  fullNameEn: z.string().min(1),
  fullNameAr: z.string().min(1),
  nationalId: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  basicSalary: z.number().nonnegative(),
  housingAllowance: z.number().nonnegative().optional(),
  otherAllowances: z.number().nonnegative().optional(),
  gosiEmployeeRate: z.number().nonnegative().optional(),
  gosiEmployerRate: z.number().nonnegative().optional(),
});

const terminateSchema = z.object({ terminationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export async function hrRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/departments",
    { preHandler: [app.authenticate, app.requirePermission("hr.employee.manage")] },
    async (request, reply) => {
      const body = departmentSchema.parse(request.body);
      const id = await withTransaction(
        (client) => createDepartment(client, { companyId: request.companyId, ...body }),
        request.authUser.id,
      );
      reply.status(201);
      return { id };
    },
  );

  app.get("/departments", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(`SELECT * FROM departments WHERE company_id = $1 ORDER BY code`, [request.companyId]);
    return result.rows;
  });

  app.post(
    "/positions",
    { preHandler: [app.authenticate, app.requirePermission("hr.employee.manage")] },
    async (request, reply) => {
      const body = positionSchema.parse(request.body);
      const id = await withTransaction(
        (client) => createPosition(client, { companyId: request.companyId, ...body }),
        request.authUser.id,
      );
      reply.status(201);
      return { id };
    },
  );

  app.get("/positions", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(`SELECT * FROM positions WHERE company_id = $1 ORDER BY code`, [request.companyId]);
    return result.rows;
  });

  app.post(
    "/employees",
    { preHandler: [app.authenticate, app.requirePermission("hr.employee.manage")] },
    async (request, reply) => {
      const body = employeeSchema.parse(request.body);
      const id = await withTransaction(
        (client) =>
          createEmployee(client, {
            companyId: request.companyId,
            departmentId: body.departmentId ?? null,
            positionId: body.positionId ?? null,
            storeId: body.storeId ?? null,
            employeeCode: body.employeeCode,
            fullNameEn: body.fullNameEn,
            fullNameAr: body.fullNameAr,
            nationalId: body.nationalId ?? null,
            nationality: body.nationality ?? null,
            hireDate: body.hireDate,
            basicSalary: body.basicSalary,
            housingAllowance: body.housingAllowance,
            otherAllowances: body.otherAllowances,
            gosiEmployeeRate: body.gosiEmployeeRate,
            gosiEmployerRate: body.gosiEmployerRate,
            createdBy: request.authUser.id,
          }),
        request.authUser.id,
      );
      reply.status(201);
      return { id };
    },
  );

  app.get("/employees", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(`SELECT * FROM employees WHERE company_id = $1 ORDER BY employee_code`, [request.companyId]);
    return result.rows;
  });

  app.get<{ Params: { id: string } }>("/employees/:id", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(`SELECT * FROM employees WHERE id = $1 AND company_id = $2`, [
      request.params.id,
      request.companyId,
    ]);
    if (result.rows.length === 0) throw new NotFoundError("employee not found");
    return result.rows[0];
  });

  app.post<{ Params: { id: string } }>(
    "/employees/:id/terminate",
    { preHandler: [app.authenticate, app.requirePermission("hr.employee.manage")] },
    async (request) => {
      const body = terminateSchema.parse(request.body);
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM employees WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("employee not found");
        await terminateEmployee(client, request.params.id, body.terminationDate);
      }, request.authUser.id);
      return { id: request.params.id, status: "terminated" };
    },
  );
}
