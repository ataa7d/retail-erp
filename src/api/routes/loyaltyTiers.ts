import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { NotFoundError } from "../errors.js";

const createSchema = z.object({
  name: z.string().min(1),
  minLifetimePoints: z.number().int().nonnegative(),
  earnMultiplier: z.number().positive().default(1),
});

export async function loyaltyTierRoutes(app: FastifyInstance): Promise<void> {
  app.get("/loyalty-tiers", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, name, min_lifetime_points, earn_multiplier, is_active
       FROM loyalty_tiers WHERE company_id = $1 ORDER BY min_lifetime_points`,
      [request.companyId],
    );
    return result.rows;
  });

  app.post(
    "/loyalty-tiers",
    { preHandler: [app.authenticate, app.requirePermission("sales.loyalty_tier.manage")] },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      const result = await withTransaction(
        (client) =>
          client.query<{ id: string }>(
            `INSERT INTO loyalty_tiers (company_id, name, min_lifetime_points, earn_multiplier) VALUES ($1, $2, $3, $4) RETURNING id`,
            [request.companyId, body.name, body.minLifetimePoints, body.earnMultiplier],
          ),
        request.authUser.id,
      );
      reply.status(201);
      return { id: result.rows[0]!.id };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/loyalty-tiers/:id/deactivate",
    { preHandler: [app.authenticate, app.requirePermission("sales.loyalty_tier.manage")] },
    async (request) => {
      const existing = await pool.query(`SELECT id FROM loyalty_tiers WHERE id = $1 AND company_id = $2`, [
        request.params.id,
        request.companyId,
      ]);
      if (existing.rows.length === 0) throw new NotFoundError("loyalty tier not found");
      await pool.query(`UPDATE loyalty_tiers SET is_active = false WHERE id = $1`, [request.params.id]);
      return { id: request.params.id, status: "inactive" };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/loyalty-tiers/:id/reactivate",
    { preHandler: [app.authenticate, app.requirePermission("sales.loyalty_tier.manage")] },
    async (request) => {
      const existing = await pool.query(`SELECT id FROM loyalty_tiers WHERE id = $1 AND company_id = $2`, [
        request.params.id,
        request.companyId,
      ]);
      if (existing.rows.length === 0) throw new NotFoundError("loyalty tier not found");
      await pool.query(`UPDATE loyalty_tiers SET is_active = true WHERE id = $1`, [request.params.id]);
      return { id: request.params.id, status: "active" };
    },
  );
}
