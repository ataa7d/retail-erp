import type { Client } from "pg";

/** A foreign-currency document was entered without a rate and none is on file for its date. */
export class MissingExchangeRateError extends Error {}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export async function getBaseCurrency(client: Client, companyId: string): Promise<string> {
  const r = await client.query<{ base_currency: string }>(`SELECT base_currency FROM companies WHERE id = $1`, [companyId]);
  if (r.rows.length === 0) throw new Error(`company ${companyId} not found`);
  return r.rows[0]!.base_currency;
}

/**
 * The rate to use for a document in `currency` dated `date`: 1 for the base
 * currency, the caller's explicit rate if given (the user may have the
 * bank's actual contract rate), otherwise the most recent rate on file on
 * or before that date.
 */
export async function resolveExchangeRate(
  client: Client,
  companyId: string,
  currency: string,
  date: string,
  explicitRate?: number | null,
): Promise<number> {
  const base = await getBaseCurrency(client, companyId);
  if (currency === base) return 1;
  if (explicitRate != null) return explicitRate;

  const r = await client.query<{ rate: string }>(
    `SELECT rate FROM exchange_rates
     WHERE company_id = $1 AND currency = $2 AND rate_date <= $3
     ORDER BY rate_date DESC LIMIT 1`,
    [companyId, currency, date],
  );
  if (r.rows.length === 0) {
    throw new MissingExchangeRateError(
      `no ${currency} exchange rate on or before ${date} -- add one under Accounting > Exchange Rates, or enter the rate on the document`,
    );
  }
  return Number(r.rows[0]!.rate);
}
