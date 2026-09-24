import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { registerAuth } from "./plugins/auth.js";
import { HttpError, pgErrorStatus } from "./errors.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { meRoutes } from "./routes/me.js";
import { companyRoutes } from "./routes/companies.js";
import { storeRoutes } from "./routes/stores.js";
import { purchasingRoutes } from "./routes/purchasing.js";
import { accountingRoutes } from "./routes/accounting.js";
import { itemRoutes } from "./routes/items.js";
import { customerRoutes } from "./routes/customers.js";
import { priceListRoutes } from "./routes/priceLists.js";
import { stockRoutes } from "./routes/stock.js";
import { inventoryRoutes } from "./routes/inventory.js";
import { salesInvoiceRoutes } from "./routes/salesInvoices.js";
import { creditNoteRoutes } from "./routes/creditNotes.js";
import { posDeviceRoutes } from "./routes/posDevices.js";
import { syncRoutes } from "./routes/sync.js";
import { fixedAssetRoutes } from "./routes/fixedAssets.js";
import { hrRoutes } from "./routes/hr.js";
import { payrollRoutes } from "./routes/payroll.js";
import { reportRoutes } from "./routes/reports.js";
import { adminRoutes } from "./routes/admin.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Dev-friendly default: reflect any origin. A deployed frontend's real
  // origin(s) should replace this via CORS_ORIGIN before going to
  // production — left wide open here since there's no browser-facing
  // deployment yet.
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true,
  });

  app.setErrorHandler((err: Error, _request, reply) => {
    if (err instanceof HttpError) {
      reply.status(err.statusCode).send({ error: err.message });
      return;
    }
    if (err instanceof ZodError) {
      reply.status(400).send({ error: "validation failed", details: err.issues });
      return;
    }
    const pgCode = (err as { code?: string }).code;
    if (pgCode) {
      const status = pgErrorStatus(pgCode);
      reply.status(status).send({ error: err.message });
      return;
    }
    app.log.error(err);
    reply.status(500).send({ error: "internal server error" });
  });

  await registerAuth(app);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(meRoutes, { prefix: "/api" });
  await app.register(companyRoutes, { prefix: "/api" });
  await app.register(storeRoutes, { prefix: "/api" });
  await app.register(purchasingRoutes, { prefix: "/api" });
  await app.register(accountingRoutes, { prefix: "/api" });
  await app.register(itemRoutes, { prefix: "/api" });
  await app.register(customerRoutes, { prefix: "/api" });
  await app.register(priceListRoutes, { prefix: "/api" });
  await app.register(stockRoutes, { prefix: "/api" });
  await app.register(inventoryRoutes, { prefix: "/api" });
  await app.register(salesInvoiceRoutes, { prefix: "/api" });
  await app.register(creditNoteRoutes, { prefix: "/api" });
  await app.register(posDeviceRoutes, { prefix: "/api" });
  await app.register(syncRoutes, { prefix: "/api" });
  await app.register(fixedAssetRoutes, { prefix: "/api" });
  await app.register(hrRoutes, { prefix: "/api" });
  await app.register(payrollRoutes, { prefix: "/api" });
  await app.register(reportRoutes, { prefix: "/api" });
  await app.register(adminRoutes, { prefix: "/api" });

  return app;
}
