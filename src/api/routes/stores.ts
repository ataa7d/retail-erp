import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";

export async function storeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/stores", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, branch_id, store_code, name_en, name_ar, store_type, city
       FROM stores WHERE company_id = $1 ORDER BY store_code`,
      [request.companyId],
    );
    return result.rows;
  });
}
