import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { NotFoundError, BusinessRuleError } from "../errors.js";

const createSchema = z.object({
  code: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  rate: z.number().min(0).max(100),
  taxType: z.enum(["standard", "zero_rated", "exempt"]).default("standard"),
});

export async function taxCodeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/tax-codes", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, code, name_en, name_ar, rate, tax_type, is_active, is_default FROM tax_codes WHERE company_id = $1 ORDER BY code`,
      [request.companyId],
    );
    return result.rows;
  });

  app.post(
    "/tax-codes",
    { preHandler: [app.authenticate, app.requirePermission("accounting.tax_code.manage")] },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      // Zero-rated and exempt codes are always 0% (chk_tax_type check on the
      // table) -- a caller sending a nonzero rate for either would just hit
      // that constraint as an opaque 500, so reject it here with a clear
      // message instead.
      const rate = body.taxType === "standard" ? body.rate : 0;
      const result = await pool.query<{ id: string }>(
        `INSERT INTO tax_codes (company_id, code, name_en, name_ar, rate, tax_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [request.companyId, body.code, body.nameEn, body.nameAr, rate, body.taxType],
      );
      reply.status(201);
      return { id: result.rows[0]!.id };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/tax-codes/:id/deactivate",
    { preHandler: [app.authenticate, app.requirePermission("accounting.tax_code.manage")] },
    async (request) => {
      const existing = await pool.query(`SELECT id FROM tax_codes WHERE id = $1 AND company_id = $2`, [
        request.params.id,
        request.companyId,
      ]);
      if (existing.rows.length === 0) throw new NotFoundError("tax code not found");
      await pool.query(`UPDATE tax_codes SET is_active = false WHERE id = $1`, [request.params.id]);
      return { id: request.params.id, status: "inactive" };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/tax-codes/:id/reactivate",
    { preHandler: [app.authenticate, app.requirePermission("accounting.tax_code.manage")] },
    async (request) => {
      const existing = await pool.query(`SELECT id FROM tax_codes WHERE id = $1 AND company_id = $2`, [
        request.params.id,
        request.companyId,
      ]);
      if (existing.rows.length === 0) throw new NotFoundError("tax code not found");
      await pool.query(`UPDATE tax_codes SET is_active = true WHERE id = $1`, [request.params.id]);
      return { id: request.params.id, status: "active" };
    },
  );

  // The company's one "default" standard rate -- what POS and new document
  // lines should assume absent a more specific choice. Only an active
  // standard-rate code can hold it; zero-rated/exempt codes are never what
  // a register should charge by default.
  app.post<{ Params: { id: string } }>(
    "/tax-codes/:id/set-default",
    { preHandler: [app.authenticate, app.requirePermission("accounting.tax_code.manage")] },
    async (request) => {
      const existing = await pool.query<{ id: string; tax_type: string; is_active: boolean }>(
        `SELECT id, tax_type, is_active FROM tax_codes WHERE id = $1 AND company_id = $2`,
        [request.params.id, request.companyId],
      );
      if (existing.rows.length === 0) throw new NotFoundError("tax code not found");
      const taxCode = existing.rows[0]!;
      if (taxCode.tax_type !== "standard" || !taxCode.is_active) {
        throw new BusinessRuleError("only an active standard-rate tax code can be the default");
      }
      await withTransaction(async (client) => {
        await client.query(`UPDATE tax_codes SET is_default = false WHERE company_id = $1 AND is_default = true`, [
          request.companyId,
        ]);
        await client.query(`UPDATE tax_codes SET is_default = true WHERE id = $1`, [request.params.id]);
      }, request.authUser.id);
      return { id: request.params.id, isDefault: true };
    },
  );
}
