import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";

const currencyCode = z.string().regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO code like USD");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const upsertSchema = z.object({
  currency: currencyCode,
  rateDate: isoDate,
  rate: z.number().positive(),
});

const lookupSchema = z.object({
  currency: currencyCode,
  date: isoDate,
});

export async function exchangeRateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/exchange-rates", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(
      `SELECT id, currency, rate_date, rate FROM exchange_rates
       WHERE company_id = $1 ORDER BY rate_date DESC, currency LIMIT 500`,
      [request.companyId],
    );
    return result.rows;
  });

  // One rate per currency per day: re-entering a day's rate corrects it
  // rather than adding a second, conflicting one. Documents snapshot the
  // rate they used, so correcting a rate never changes anything already
  // posted.
  app.post(
    "/exchange-rates",
    { preHandler: [app.authenticate, app.requirePermission("accounting.exchange_rate.manage")] },
    async (request, reply) => {
      const body = upsertSchema.parse(request.body);
      const id = await withTransaction(async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO exchange_rates (company_id, currency, rate_date, rate, created_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (company_id, currency, rate_date) DO UPDATE SET rate = EXCLUDED.rate
           RETURNING id`,
          [request.companyId, body.currency, body.rateDate, body.rate, request.authUser.id],
        );
        return result.rows[0]!.id;
      }, request.authUser.id);
      reply.status(201);
      return { id };
    },
  );

  // The rate a document dated `date` would use by default: 1 for the base
  // currency, else the latest rate on or before that date (null if none).
  app.get("/exchange-rates/lookup", { preHandler: app.authenticate }, async (request) => {
    const query = lookupSchema.parse(request.query);
    const company = await pool.query<{ base_currency: string }>(`SELECT base_currency FROM companies WHERE id = $1`, [request.companyId]);
    if (company.rows[0]!.base_currency === query.currency) {
      return { currency: query.currency, rate: 1, rateDate: null, isBaseCurrency: true };
    }
    const result = await pool.query<{ rate: string; rate_date: Date }>(
      `SELECT rate, rate_date FROM exchange_rates
       WHERE company_id = $1 AND currency = $2 AND rate_date <= $3
       ORDER BY rate_date DESC LIMIT 1`,
      [request.companyId, query.currency, query.date],
    );
    const row = result.rows[0];
    return {
      currency: query.currency,
      rate: row ? Number(row.rate) : null,
      rateDate: row ? row.rate_date : null,
      isBaseCurrency: false,
    };
  });
}
