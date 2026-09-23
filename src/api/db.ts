import "dotenv/config";
import { Pool, type PoolClient } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

export const pool = new Pool({ connectionString });

/**
 * One transaction per request. Sets app.current_user_id for the duration
 * of the transaction (via set_config, not a literal SET — SET doesn't
 * accept bind parameters) so fn_audit_trigger attributes every change in
 * this request to the actual actor, not just "system".
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  actorUserId?: string | null,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (actorUserId) {
      await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [actorUserId]);
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
