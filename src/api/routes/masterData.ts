import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import { NotFoundError } from "../errors.js";

const brandSchema = z.object({
  code: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
});

const categorySchema = z.object({
  code: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  parentId: z.string().uuid().nullable().optional(),
});

const seasonSchema = z.object({
  code: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
});

export async function masterDataRoutes(app: FastifyInstance): Promise<void> {
  // Brands
  app.get("/brands", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, code, name_en, name_ar, is_active FROM brands WHERE company_id = $1 ORDER BY code`,
      [request.companyId],
    );
    return result.rows;
  });

  app.post(
    "/brands",
    { preHandler: [app.authenticate, app.requirePermission("inventory.items.manage")] },
    async (request, reply) => {
      const body = brandSchema.parse(request.body);
      const result = await pool.query<{ id: string }>(
        `INSERT INTO brands (company_id, code, name_en, name_ar) VALUES ($1, $2, $3, $4) RETURNING id`,
        [request.companyId, body.code, body.nameEn, body.nameAr],
      );
      reply.status(201);
      return { id: result.rows[0]!.id };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/brands/:id/deactivate",
    { preHandler: [app.authenticate, app.requirePermission("inventory.items.manage")] },
    async (request) => {
      const existing = await pool.query(`SELECT id FROM brands WHERE id = $1 AND company_id = $2`, [
        request.params.id,
        request.companyId,
      ]);
      if (existing.rows.length === 0) throw new NotFoundError("brand not found");
      await pool.query(`UPDATE brands SET is_active = false WHERE id = $1`, [request.params.id]);
      return { id: request.params.id, status: "inactive" };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/brands/:id/reactivate",
    { preHandler: [app.authenticate, app.requirePermission("inventory.items.manage")] },
    async (request) => {
      const existing = await pool.query(`SELECT id FROM brands WHERE id = $1 AND company_id = $2`, [
        request.params.id,
        request.companyId,
      ]);
      if (existing.rows.length === 0) throw new NotFoundError("brand not found");
      await pool.query(`UPDATE brands SET is_active = true WHERE id = $1`, [request.params.id]);
      return { id: request.params.id, status: "active" };
    },
  );

  // Categories (tree via parent_id)
  app.get("/categories", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, code, name_en, name_ar, parent_id, is_active FROM categories WHERE company_id = $1 ORDER BY code`,
      [request.companyId],
    );
    return result.rows;
  });

  app.post(
    "/categories",
    { preHandler: [app.authenticate, app.requirePermission("inventory.items.manage")] },
    async (request, reply) => {
      const body = categorySchema.parse(request.body);
      const result = await pool.query<{ id: string }>(
        `INSERT INTO categories (company_id, code, name_en, name_ar, parent_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [request.companyId, body.code, body.nameEn, body.nameAr, body.parentId ?? null],
      );
      reply.status(201);
      return { id: result.rows[0]!.id };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/categories/:id/deactivate",
    { preHandler: [app.authenticate, app.requirePermission("inventory.items.manage")] },
    async (request) => {
      const existing = await pool.query(`SELECT id FROM categories WHERE id = $1 AND company_id = $2`, [
        request.params.id,
        request.companyId,
      ]);
      if (existing.rows.length === 0) throw new NotFoundError("category not found");
      await pool.query(`UPDATE categories SET is_active = false WHERE id = $1`, [request.params.id]);
      return { id: request.params.id, status: "inactive" };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/categories/:id/reactivate",
    { preHandler: [app.authenticate, app.requirePermission("inventory.items.manage")] },
    async (request) => {
      const existing = await pool.query(`SELECT id FROM categories WHERE id = $1 AND company_id = $2`, [
        request.params.id,
        request.companyId,
      ]);
      if (existing.rows.length === 0) throw new NotFoundError("category not found");
      await pool.query(`UPDATE categories SET is_active = true WHERE id = $1`, [request.params.id]);
      return { id: request.params.id, status: "active" };
    },
  );

  // Seasons
  app.get("/seasons", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, code, name_en, name_ar, is_active FROM seasons WHERE company_id = $1 ORDER BY code`,
      [request.companyId],
    );
    return result.rows;
  });

  app.post(
    "/seasons",
    { preHandler: [app.authenticate, app.requirePermission("inventory.items.manage")] },
    async (request, reply) => {
      const body = seasonSchema.parse(request.body);
      const result = await pool.query<{ id: string }>(
        `INSERT INTO seasons (company_id, code, name_en, name_ar) VALUES ($1, $2, $3, $4) RETURNING id`,
        [request.companyId, body.code, body.nameEn, body.nameAr],
      );
      reply.status(201);
      return { id: result.rows[0]!.id };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/seasons/:id/deactivate",
    { preHandler: [app.authenticate, app.requirePermission("inventory.items.manage")] },
    async (request) => {
      const existing = await pool.query(`SELECT id FROM seasons WHERE id = $1 AND company_id = $2`, [
        request.params.id,
        request.companyId,
      ]);
      if (existing.rows.length === 0) throw new NotFoundError("season not found");
      await pool.query(`UPDATE seasons SET is_active = false WHERE id = $1`, [request.params.id]);
      return { id: request.params.id, status: "inactive" };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/seasons/:id/reactivate",
    { preHandler: [app.authenticate, app.requirePermission("inventory.items.manage")] },
    async (request) => {
      const existing = await pool.query(`SELECT id FROM seasons WHERE id = $1 AND company_id = $2`, [
        request.params.id,
        request.companyId,
      ]);
      if (existing.rows.length === 0) throw new NotFoundError("season not found");
      await pool.query(`UPDATE seasons SET is_active = true WHERE id = $1`, [request.params.id]);
      return { id: request.params.id, status: "active" };
    },
  );
}
