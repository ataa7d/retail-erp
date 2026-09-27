import type { Client } from "pg";
import { BusinessRuleError, NotFoundError } from "../api/errors.js";
import { nextDocumentNumber, getAccountId } from "./salesService.js";

// Simple, fixed conversion rates rather than a per-company setting --
// same scope call as POS.tsx's hardcoded VAT_RATE. 1 point per 10
// currency units of net sale earned; each point is worth 0.05 when
// redeemed (20 points = 1 unit of currency).
export const POINTS_PER_CURRENCY_UNIT = 0.1;
export const POINT_REDEMPTION_VALUE = 0.05;

export interface EarnLoyaltyPointsParams {
  companyId: string;
  customerId: string;
  netAmount: number;
  fiscalPeriodId: string;
  earnDate: string; // YYYY-MM-DD
  salesInvoiceId: string;
  earnedBy: string | null;
}

// Called once per posted POS invoice for an enrolled loyalty member (see
// postSalesInvoice) -- books its own small accrual journal, separate from
// the invoice's own journal, since it's a distinct accounting event (a
// marketing cost incurred by the sale, not part of the sale itself).
export async function earnLoyaltyPoints(client: Client, p: EarnLoyaltyPointsParams): Promise<void> {
  const pointsEarned = Math.floor(p.netAmount * POINTS_PER_CURRENCY_UNIT);
  if (pointsEarned <= 0) return;

  const customer = await client.query<{ loyalty_points_balance: number }>(
    `SELECT loyalty_points_balance FROM customers WHERE id = $1 FOR UPDATE`,
    [p.customerId],
  );
  if (customer.rows.length === 0) throw new NotFoundError(`customer ${p.customerId} not found`);
  const newBalance = customer.rows[0]!.loyalty_points_balance + pointsEarned;

  const expenseAccountId = await getAccountId(client, p.companyId, "5130");
  const liabilityAccountId = await getAccountId(client, p.companyId, "2160");
  const accrualValue = Math.round(pointsEarned * POINT_REDEMPTION_VALUE * 100) / 100;

  const fiscalYear = Number(p.earnDate.slice(0, 4));
  const journalNumber = await nextDocumentNumber(client, p.companyId, "journal", fiscalYear, "GJ-");
  const journal = await client.query<{ id: string }>(
    `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type, source_id, memo, created_by)
     VALUES ($1, $2, $3, $4, 'loyalty_points_earn', $5, $6, $7) RETURNING id`,
    [p.companyId, journalNumber, p.earnDate, p.fiscalPeriodId, p.salesInvoiceId, `${pointsEarned} loyalty points earned`, p.earnedBy],
  );
  const journalId = journal.rows[0]!.id;

  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
     VALUES ($1, $2, 1, $3, $4, 'loyalty points accrued')`,
    [p.companyId, journalId, expenseAccountId, accrualValue],
  );
  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
     VALUES ($1, $2, 2, $3, $4, 'loyalty points liability')`,
    [p.companyId, journalId, liabilityAccountId, accrualValue],
  );
  await client.query(`UPDATE journals SET document_status = 'posted', posted_at = now(), posted_by = $2 WHERE id = $1`, [
    journalId,
    p.earnedBy,
  ]);

  await client.query(`UPDATE customers SET loyalty_points_balance = $2 WHERE id = $1`, [p.customerId, newBalance]);
  await client.query(
    `INSERT INTO loyalty_points_transactions (company_id, customer_id, transaction_type, points, balance_after, sales_invoice_id, journal_id, created_by)
     VALUES ($1, $2, 'earn', $3, $4, $5, $6, $7)`,
    [p.companyId, p.customerId, pointsEarned, newBalance, p.salesInvoiceId, journalId, p.earnedBy],
  );
}

export interface RedeemLoyaltyPointsParams {
  companyId: string;
  customerId: string;
  amount: number;
  salesInvoiceId: string;
  redeemedBy: string | null;
}

// Called from salesService.postSalesInvoice for every payment row with
// payment_method = 'points', inside the same transaction as the invoice
// posting -- an unenrolled customer or an insufficient balance fails the
// whole post, same as gift cards.
export async function redeemLoyaltyPoints(client: Client, p: RedeemLoyaltyPointsParams): Promise<void> {
  const pointsNeeded = Math.round(p.amount / POINT_REDEMPTION_VALUE);
  if (Math.abs(pointsNeeded * POINT_REDEMPTION_VALUE - p.amount) > 0.001) {
    throw new BusinessRuleError(`points payment of ${p.amount} is not a multiple of the point value (${POINT_REDEMPTION_VALUE})`);
  }

  const customer = await client.query<{ is_loyalty_member: boolean; loyalty_points_balance: number }>(
    `SELECT is_loyalty_member, loyalty_points_balance FROM customers WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [p.customerId, p.companyId],
  );
  if (customer.rows.length === 0) throw new NotFoundError(`customer ${p.customerId} not found`);
  const c = customer.rows[0]!;
  if (!c.is_loyalty_member) {
    throw new BusinessRuleError(`customer ${p.customerId} is not enrolled in the loyalty program`);
  }
  if (c.loyalty_points_balance < pointsNeeded) {
    throw new BusinessRuleError(`insufficient points balance (${c.loyalty_points_balance} available, ${pointsNeeded} requested)`);
  }

  const newBalance = c.loyalty_points_balance - pointsNeeded;
  await client.query(`UPDATE customers SET loyalty_points_balance = $2 WHERE id = $1`, [p.customerId, newBalance]);
  await client.query(
    `INSERT INTO loyalty_points_transactions (company_id, customer_id, transaction_type, points, balance_after, sales_invoice_id, created_by)
     VALUES ($1, $2, 'redeem', $3, $4, $5, $6)`,
    [p.companyId, p.customerId, -pointsNeeded, newBalance, p.salesInvoiceId, p.redeemedBy],
  );
}
