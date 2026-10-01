import "dotenv/config";
import { buildApp } from "./app.js";
import { registerDispatcher } from "../notifications/dispatch.js";

async function main() {
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";
  await app.listen({ port, host });
  console.log(`API listening on http://${host}:${port}`);
  registerDispatcher();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
