import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { registerPosDevice, retirePosDevice } from "../../sync/posDeviceService.js";
import { NotFoundError } from "../errors.js";

const registerSchema = z.object({
  storeId: z.string().uuid(),
  deviceCode: z.string().min(1),
  deviceName: z.string().min(1),
  // Must end in a dash so the sync service can safely append 'INV-000001' /
  // 'CN-000001' without gluing onto the last character of the prefix.
  seriesPrefix: z.string().regex(/^[A-Z0-9]+-[A-Z0-9]+-$/, "series prefix must look like 'ST01-POS3-'"),
});

export async function posDeviceRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/pos-devices",
    { preHandler: [app.authenticate, app.requirePermission("sales.pos_device.manage")] },
    async (request, reply) => {
      const body = registerSchema.parse(request.body);
      const deviceId = await withTransaction(async (client) => {
        return registerPosDevice(client, {
          companyId: request.companyId,
          storeId: body.storeId,
          deviceCode: body.deviceCode,
          deviceName: body.deviceName,
          seriesPrefix: body.seriesPrefix,
          createdBy: request.authUser.id,
        });
      }, request.authUser.id);
      reply.status(201);
      return { id: deviceId };
    },
  );

  app.get("/pos-devices", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT pd.id, pd.store_id, pd.device_code, pd.device_name, pd.series_prefix, pd.status,
              pd.registered_at, pd.retired_at,
              inv_seq.last_synced_seq AS last_synced_invoice_seq,
              cn_seq.last_synced_seq AS last_synced_credit_note_seq
       FROM pos_devices pd
       LEFT JOIN pos_device_sequences inv_seq ON inv_seq.device_id = pd.id AND inv_seq.document_type = 'pos_invoice'
       LEFT JOIN pos_device_sequences cn_seq ON cn_seq.device_id = pd.id AND cn_seq.document_type = 'credit_note'
       WHERE pd.company_id = $1
       ORDER BY pd.device_code`,
      [request.companyId],
    );
    return result.rows;
  });

  app.post<{ Params: { id: string } }>(
    "/pos-devices/:id/retire",
    { preHandler: [app.authenticate, app.requirePermission("sales.pos_device.manage")] },
    async (request) => {
      await withTransaction(async (client) => {
        const existing = await client.query(`SELECT id FROM pos_devices WHERE id = $1 AND company_id = $2`, [
          request.params.id,
          request.companyId,
        ]);
        if (existing.rows.length === 0) throw new NotFoundError("pos device not found");
        await retirePosDevice(client, request.params.id);
      }, request.authUser.id);
      return { id: request.params.id, status: "retired" };
    },
  );
}
