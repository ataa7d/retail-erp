import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { NotFoundError } from "../errors.js";
import { bootstrapCompany } from "../../companies/companyBootstrapService.js";

const updateCompanySchema = z.object({
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  crNumber: z.string().nullable().optional(),
  vatRegistrationNumber: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
});

const createCompanySchema = z.object({
  companyCode: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  country: z.string().min(1),
  baseCurrency: z.string().length(3),
  crNumber: z.string().nullable().optional(),
  vatRegistrationNumber: z.string().nullable().optional(),
  vatRate: z.number().min(0).max(100),
  fiscalYearStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// The one route a frontend can call before it has a company selected —
// list the companies this user actually has access to, so it can show a
// company picker. Every other route requires X-Company-Id up front.
export async function companyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/companies", { preHandler: app.authenticateUser }, async (request) => {
    const result = await pool.query(
      `SELECT c.id, c.company_code, c.name_en, c.name_ar, c.base_currency
       FROM companies c
       JOIN user_company_access uca ON uca.company_id = c.id
       WHERE uca.user_id = $1 AND uca.is_active = true
       ORDER BY c.name_en`,
      [request.authUser.id],
    );
    return result.rows;
  });

  // Creating a brand-new company, not switching between ones the user
  // already has -- same reasoning as the picker above: no X-Company-Id
  // exists yet for a company that doesn't exist yet, so this only needs
  // authenticateUser. The creating user becomes that company's
  // Administrator (every permission) via bootstrapCompany, the same way
  // scripts/seed.ts does it by hand for the one demo company.
  app.post("/companies", { preHandler: app.authenticateUser }, async (request, reply) => {
    const body = createCompanySchema.parse(request.body);
    const { companyId } = await withTransaction(
      (client) =>
        bootstrapCompany(client, {
          companyCode: body.companyCode,
          nameEn: body.nameEn,
          nameAr: body.nameAr,
          country: body.country,
          baseCurrency: body.baseCurrency.toUpperCase(),
          crNumber: body.crNumber,
          vatRegistrationNumber: body.vatRegistrationNumber,
          vatRate: body.vatRate,
          fiscalYearStart: body.fiscalYearStart,
          createdByUserId: request.authUser.id,
        }),
      request.authUser.id,
    );
    reply.status(201);
    return { id: companyId };
  });

  // The seller-side details a printed invoice needs (name, VAT number, CR
  // number) that the company picker above deliberately doesn't return --
  // that route runs before a company is even selected, this one requires
  // X-Company-Id like every other authenticated route.
  app.get("/companies/current", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, company_code, name_en, name_ar, vat_registration_number, cr_number, address, base_currency
       FROM companies WHERE id = $1`,
      [request.companyId],
    );
    if (result.rows.length === 0) throw new NotFoundError("company not found");
    return result.rows[0];
  });

  app.post(
    "/companies/current",
    { preHandler: [app.authenticate, app.requirePermission("admin.companies.manage")] },
    async (request) => {
      const body = updateCompanySchema.parse(request.body);
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE companies SET name_en = $1, name_ar = $2, cr_number = $3, vat_registration_number = $4, address = $5 WHERE id = $6`,
          [body.nameEn, body.nameAr, body.crNumber ?? null, body.vatRegistrationNumber ?? null, body.address ?? null, request.companyId],
        );
      }, request.authUser.id);
      return { id: request.companyId };
    },
  );
}
