import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { openCashShift, closeCashShift, computeZReport } from "../../sales/cashShiftService.js";
import { NotFoundError } from "../errors.js";

const openSchema = z.object({
  storeId: z.string().uuid(),
  deviceId: z.string().uuid(),
  openingFloat: z.number().nonnegative(),
  openingNotes: z.string().nullable().optional(),
});

const closeSchema = z.object({
  closingFloatCounted: z.number().nonnegative(),
  closingNotes: z.string().nullable().optional(),
});

export async function cashShiftRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/cash-shifts",
    { preHandler: [app.authenticate, app.requirePermission("sales.cash_shift.open")] },
    async (request, reply) => {
      const body = openSchema.parse(request.body);
      const id = await withTransaction(
        (client) =>
          openCashShift(client, {
            companyId: request.companyId,
            storeId: body.storeId,
            deviceId: body.deviceId,
            openingFloat: body.openingFloat,
            openedBy: request.authUser.id,
            openingNotes: body.openingNotes ?? null,
          }),
        request.authUser.id,
      );
      reply.status(201);
      return { id };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/cash-shifts/:id/close",
    { preHandler: [app.authenticate, app.requirePermission("sales.cash_shift.open")] },
    async (request) => {
      const body = closeSchema.parse(request.body);
      await withTransaction(
        (client) =>
          closeCashShift(client, {
            shiftId: request.params.id,
            companyId: request.companyId,
            closingFloatCounted: body.closingFloatCounted,
            closedBy: request.authUser.id,
            closingNotes: body.closingNotes ?? null,
          }),
        request.authUser.id,
      );
      return { id: request.params.id, status: "closed" };
    },
  );

  // The device's own currently-open shift, if any -- drives the POS UI's
  // "you have an open shift" / "open a new shift" gate.
  app.get<{ Querystring: { deviceId: string } }>("/cash-shifts/open", { preHandler: app.authenticate }, async (request) => {
    const query = z.object({ deviceId: z.string().uuid() }).parse(request.query);
    const result = await pool.query(
      `SELECT id FROM cash_shifts WHERE company_id = $1 AND device_id = $2 AND status = 'open'`,
      [request.companyId, query.deviceId],
    );
    return { id: result.rows[0]?.id ?? null };
  });

  app.get("/cash-shifts", { preHandler: [app.authenticate, app.requirePermission("sales.cash_shift.view")] }, async (request) => {
    const result = await pool.query(
      `SELECT cs.id, cs.status, cs.opening_float, cs.opened_at, cs.closing_float_counted, cs.closed_at,
              pd.device_code, pd.device_name, s.name_en AS store_name_en,
              ou.email AS opened_by_email, cu.email AS closed_by_email
       FROM cash_shifts cs
       JOIN pos_devices pd ON pd.id = cs.device_id
       JOIN stores s ON s.id = cs.store_id
       LEFT JOIN users ou ON ou.id = cs.opened_by
       LEFT JOIN users cu ON cu.id = cs.closed_by
       WHERE cs.company_id = $1
       ORDER BY cs.opened_at DESC
       LIMIT 200`,
      [request.companyId],
    );
    return result.rows;
  });

  app.get<{ Params: { id: string } }>(
    "/cash-shifts/:id",
    { preHandler: [app.authenticate, app.requirePermission("sales.cash_shift.view")] },
    async (request) => {
      const header = await pool.query(
        `SELECT cs.*, pd.device_code, pd.device_name, s.name_en AS store_name_en,
                ou.email AS opened_by_email, cu.email AS closed_by_email
         FROM cash_shifts cs
         JOIN pos_devices pd ON pd.id = cs.device_id
         JOIN stores s ON s.id = cs.store_id
         LEFT JOIN users ou ON ou.id = cs.opened_by
         LEFT JOIN users cu ON cu.id = cs.closed_by
         WHERE cs.id = $1 AND cs.company_id = $2`,
        [request.params.id, request.companyId],
      );
      if (header.rows.length === 0) throw new NotFoundError("cash shift not found");
      return header.rows[0];
    },
  );

  app.get<{ Params: { id: string } }>(
    "/cash-shifts/:id/z-report",
    { preHandler: [app.authenticate, app.requirePermission("sales.cash_shift.view")] },
    async (request) => {
      return computeZReport(pool, request.companyId, request.params.id);
    },
  );
}
