import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { NotFoundError } from "../errors.js";

const createSchema = z.object({
  branchCode: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  crNumber: z.string().nullable().optional(),
  vatRegistrationNumber: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
});

const updateSchema = createSchema.omit({ branchCode: true });

export async function branchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/branches", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, branch_code, name_en, name_ar, cr_number, vat_registration_number, address, city, is_active
       FROM branches WHERE company_id = $1 ORDER BY branch_code`,
      [request.companyId],
    );
    return result.rows;
  });

  app.post(
    "/branches",
    { preHandler: [app.authenticate, app.requirePermission("admin.companies.manage")] },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      const branchId = await withTransaction(async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO branches (company_id, branch_code, name_en, name_ar, cr_number, vat_registration_number, address, city)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            request.companyId,
            body.branchCode,
            body.nameEn,
            body.nameAr,
            body.crNumber ?? null,
            body.vatRegistrationNumber ?? null,
            body.address ?? null,
            body.city ?? null,
          ],
        );
        return result.rows[0]!.id;
      }, request.authUser.id);
      reply.status(201);
      return { id: branchId };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/branches/:id",
    { preHandler: [app.authenticate, app.requirePermission("admin.companies.manage")] },
    async (request) => {
      const body = updateSchema.parse(request.body);
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM branches WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("branch not found");
        await client.query(
          `UPDATE branches SET name_en = $1, name_ar = $2, cr_number = $3, vat_registration_number = $4, address = $5, city = $6
           WHERE id = $7`,
          [
            body.nameEn,
            body.nameAr,
            body.crNumber ?? null,
            body.vatRegistrationNumber ?? null,
            body.address ?? null,
            body.city ?? null,
            request.params.id,
          ],
        );
      }, request.authUser.id);
      return { id: request.params.id };
    },
  );
}
