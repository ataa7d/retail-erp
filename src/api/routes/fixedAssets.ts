import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { acquireFixedAsset, createDepreciationRun, postDepreciationRun, disposeFixedAsset } from "../../assets/fixedAssetService.js";
import { NotFoundError } from "../errors.js";

const categorySchema = z.object({
  code: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  defaultUsefulLifeMonths: z.number().int().positive(),
  assetAccountId: z.string().uuid(),
  accumulatedDepreciationAccountId: z.string().uuid(),
  depreciationExpenseAccountId: z.string().uuid(),
});

const acquireSchema = z.object({
  assetCategoryId: z.string().uuid(),
  storeId: z.string().uuid().nullable().optional(),
  assetCode: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  acquisitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  acquisitionCost: z.number().positive(),
  salvageValue: z.number().nonnegative().default(0),
  usefulLifeMonthsOverride: z.number().int().positive().nullable().optional(),
  fiscalPeriodId: z.string().uuid(),
});

const depreciationRunSchema = z.object({
  fiscalPeriodId: z.string().uuid(),
  runDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const disposeSchema = z.object({
  disposalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  proceeds: z.number().nonnegative(),
  fiscalPeriodId: z.string().uuid(),
});

export async function fixedAssetRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/asset-categories",
    { preHandler: [app.authenticate, app.requirePermission("assets.fixed_asset.manage")] },
    async (request, reply) => {
      const body = categorySchema.parse(request.body);
      const result = await pool.query<{ id: string }>(
        `INSERT INTO asset_categories
           (company_id, code, name_en, name_ar, default_useful_life_months,
            asset_account_id, accumulated_depreciation_account_id, depreciation_expense_account_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          request.companyId,
          body.code,
          body.nameEn,
          body.nameAr,
          body.defaultUsefulLifeMonths,
          body.assetAccountId,
          body.accumulatedDepreciationAccountId,
          body.depreciationExpenseAccountId,
        ],
      );
      reply.status(201);
      return { id: result.rows[0]!.id };
    },
  );

  app.get("/asset-categories", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(`SELECT * FROM asset_categories WHERE company_id = $1 ORDER BY code`, [request.companyId]);
    return result.rows;
  });

  app.post(
    "/fixed-assets",
    { preHandler: [app.authenticate, app.requirePermission("assets.fixed_asset.manage")] },
    async (request, reply) => {
      const body = acquireSchema.parse(request.body);
      const assetId = await withTransaction(async (client) => {
        return acquireFixedAsset(client, {
          companyId: request.companyId,
          assetCategoryId: body.assetCategoryId,
          storeId: body.storeId ?? null,
          assetCode: body.assetCode,
          nameEn: body.nameEn,
          nameAr: body.nameAr,
          acquisitionDate: body.acquisitionDate,
          acquisitionCost: body.acquisitionCost,
          salvageValue: body.salvageValue,
          useful_lifeMonthsOverride: body.usefulLifeMonthsOverride ?? null,
          fiscalPeriodId: body.fiscalPeriodId,
          createdBy: request.authUser.id,
        });
      }, request.authUser.id);
      reply.status(201);
      return { id: assetId };
    },
  );

  app.get("/fixed-assets", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT * FROM fixed_assets WHERE company_id = $1 ORDER BY asset_code`,
      [request.companyId],
    );
    return result.rows;
  });

  app.get<{ Params: { id: string } }>("/fixed-assets/:id", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(`SELECT * FROM fixed_assets WHERE id = $1 AND company_id = $2`, [
      request.params.id,
      request.companyId,
    ]);
    if (result.rows.length === 0) throw new NotFoundError("fixed asset not found");
    return result.rows[0];
  });

  app.post<{ Params: { id: string } }>(
    "/fixed-assets/:id/dispose",
    { preHandler: [app.authenticate, app.requirePermission("assets.fixed_asset.manage")] },
    async (request) => {
      const body = disposeSchema.parse(request.body);
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM fixed_assets WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("fixed asset not found");
        await disposeFixedAsset(client, {
          assetId: request.params.id,
          disposalDate: body.disposalDate,
          proceeds: body.proceeds,
          fiscalPeriodId: body.fiscalPeriodId,
          postedBy: request.authUser.id,
        });
      }, request.authUser.id);
      return { id: request.params.id, status: "disposed" };
    },
  );

  app.post(
    "/depreciation-runs",
    { preHandler: [app.authenticate, app.requirePermission("assets.depreciation.post")] },
    async (request, reply) => {
      const body = depreciationRunSchema.parse(request.body);
      const runId = await withTransaction(async (client) => {
        return createDepreciationRun(client, {
          companyId: request.companyId,
          fiscalPeriodId: body.fiscalPeriodId,
          runDate: body.runDate,
          createdBy: request.authUser.id,
        });
      }, request.authUser.id);
      reply.status(201);
      return { id: runId };
    },
  );

  app.get("/depreciation-runs", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, document_number, run_date, document_status FROM depreciation_runs WHERE company_id = $1 ORDER BY run_date DESC`,
      [request.companyId],
    );
    return result.rows;
  });

  app.get<{ Params: { id: string } }>("/depreciation-runs/:id", { preHandler: app.authenticate }, async (request) => {
    const header = await pool.query(`SELECT * FROM depreciation_runs WHERE id = $1 AND company_id = $2`, [
      request.params.id,
      request.companyId,
    ]);
    if (header.rows.length === 0) throw new NotFoundError("depreciation run not found");
    const lines = await pool.query(`SELECT * FROM depreciation_run_lines WHERE depreciation_run_id = $1`, [request.params.id]);
    return { ...header.rows[0], lines: lines.rows };
  });

  app.post<{ Params: { id: string } }>(
    "/depreciation-runs/:id/post",
    { preHandler: [app.authenticate, app.requirePermission("assets.depreciation.post")] },
    async (request) => {
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM depreciation_runs WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("depreciation run not found");
        await postDepreciationRun(client, request.params.id, request.authUser.id);
      }, request.authUser.id);
      return { id: request.params.id, status: "posted" };
    },
  );
}
