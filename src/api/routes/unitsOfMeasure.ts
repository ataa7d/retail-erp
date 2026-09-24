import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";

export async function unitOfMeasureRoutes(app: FastifyInstance): Promise<void> {
  app.get("/units-of-measure", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, code, name_en, name_ar, is_active FROM units_of_measure WHERE company_id = $1 ORDER BY code`,
      [request.companyId],
    );
    return result.rows;
  });
}
