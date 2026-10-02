import type { Client } from "pg";
import { BusinessRuleError } from "../api/errors.js";

/**
 * Every document type used to make the user pick a fiscal period by hand,
 * separately from the document's own date -- a redundant step, since a
 * transaction's period is implied by its date. This resolves it
 * server-side instead: the one place fiscal-period lookup happens, so every
 * create route can drop its fiscalPeriodId input and just pass the date it
 * already collects (order date, invoice date, journal date, ...).
 */
export async function resolveFiscalPeriodId(client: Client, companyId: string, date: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM fiscal_periods WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
    [companyId, date],
  );
  if (result.rows.length === 0) {
    throw new BusinessRuleError(
      `No fiscal period covers ${date}. Ask an administrator to set up a fiscal year that includes this date.`,
    );
  }
  return result.rows[0]!.id;
}
