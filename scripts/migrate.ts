import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "..", "migrations");

async function ensureMigrationsTable(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

async function up(client: Client) {
  await ensureMigrationsTable(client);
  const applied = new Set(
    (await client.query<{ filename: string }>("SELECT filename FROM schema_migrations")).rows.map(
      (r) => r.filename,
    ),
  );

  const pending = migrationFiles().filter((f) => !applied.has(f));
  if (pending.length === 0) {
    console.log("No pending migrations.");
    return;
  }

  for (const file of pending) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    console.log(`Applying ${file} ...`);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`  ok`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`  FAILED: ${file}`);
      throw err;
    }
  }
}

async function status(client: Client) {
  await ensureMigrationsTable(client);
  const applied = new Set(
    (await client.query<{ filename: string }>("SELECT filename FROM schema_migrations")).rows.map(
      (r) => r.filename,
    ),
  );
  for (const file of migrationFiles()) {
    console.log(`${applied.has(file) ? "[applied]" : "[pending]"} ${file}`);
  }
}

async function main() {
  const command = process.argv[2] ?? "up";
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    if (command === "up") {
      await up(client);
    } else if (command === "status") {
      await status(client);
    } else if (command === "down") {
      throw new Error(
        "Down migrations are intentionally not supported. Write a new forward migration instead.",
      );
    } else {
      throw new Error(`Unknown command: ${command}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
