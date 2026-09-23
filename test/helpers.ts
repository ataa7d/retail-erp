import "dotenv/config";
import { Client } from "pg";

export function newClient(): Client {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
  return new Client({ connectionString });
}

export async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = newClient();
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
