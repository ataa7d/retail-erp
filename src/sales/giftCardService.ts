import type { Client } from "pg";
import { BusinessRuleError, NotFoundError } from "../api/errors.js";
import { nextDocumentNumber, getAccountId } from "./salesService.js";

export interface IssueGiftCardParams {
  companyId: string;
  storeId: string;
  cardNumber: string;
  initialValue: number;
  paymentMethod: "cash" | "card";
  customerId?: string | null;
  expiresAt?: string | null;
  fiscalPeriodId: string;
  issueDate: string; // YYYY-MM-DD
  issuedBy: string | null;
}

// Issuing a gift card is not a sale -- it's collecting cash today against a
// promise to deliver merchandise later, so it books as a liability
// (2150), not revenue. Revenue is recognized normally, through the
// ordinary sales-invoice posting path, only once the card is redeemed.
export async function issueGiftCard(client: Client, p: IssueGiftCardParams): Promise<string> {
  const existing = await client.query(`SELECT id FROM gift_cards WHERE company_id = $1 AND card_number = $2`, [p.companyId, p.cardNumber]);
  if (existing.rows.length > 0) {
    throw new BusinessRuleError(`a gift card with number ${p.cardNumber} already exists`);
  }

  // Card and cash are both treated as cash-equivalents here, matching how
  // every other POS posting in this codebase books them (see
  // postSalesInvoice's payment loop).
  const cashAccountId = await getAccountId(client, p.companyId, "1110");
  const liabilityAccountId = await getAccountId(client, p.companyId, "2150");

  const fiscalYear = Number(p.issueDate.slice(0, 4));
  const journalNumber = await nextDocumentNumber(client, p.companyId, "journal", fiscalYear, "GJ-");
  const journal = await client.query<{ id: string }>(
    `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type, memo, created_by)
     VALUES ($1, $2, $3, $4, 'gift_card_issue', $5, $6) RETURNING id`,
    [p.companyId, journalNumber, p.issueDate, p.fiscalPeriodId, `Gift card ${p.cardNumber} issued`, p.issuedBy],
  );
  const journalId = journal.rows[0]!.id;

  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
     VALUES ($1, $2, 1, $3, $4, $5)`,
    [p.companyId, journalId, cashAccountId, p.initialValue, `${p.paymentMethod} received for gift card`],
  );
  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
     VALUES ($1, $2, 2, $3, $4, 'gift card liability')`,
    [p.companyId, journalId, liabilityAccountId, p.initialValue],
  );
  await client.query(`UPDATE journals SET document_status = 'posted', posted_at = now(), posted_by = $2 WHERE id = $1`, [
    journalId,
    p.issuedBy,
  ]);

  const card = await client.query<{ id: string }>(
    `INSERT INTO gift_cards (company_id, store_id, card_number, initial_value, balance, customer_id, expires_at, journal_id, issued_by)
     VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8) RETURNING id`,
    [p.companyId, p.storeId, p.cardNumber, p.initialValue, p.customerId ?? null, p.expiresAt ?? null, journalId, p.issuedBy],
  );
  const cardId = card.rows[0]!.id;

  await client.query(
    `INSERT INTO gift_card_transactions (company_id, gift_card_id, transaction_type, amount, balance_after, created_by)
     VALUES ($1, $2, 'issue', $3, $3, $4)`,
    [p.companyId, cardId, p.initialValue, p.issuedBy],
  );

  return cardId;
}

export interface RedeemGiftCardParams {
  companyId: string;
  cardNumber: string;
  amount: number;
  salesInvoiceId: string;
  redeemedBy: string | null;
}

// Called from salesService.postSalesInvoice for every payment row with
// payment_method = 'gift_card', inside the same transaction as the
// invoice posting -- if any card is invalid or short, the whole invoice
// fails to post and stays a draft, same as an underpaid POS invoice.
export async function redeemGiftCard(client: Client, p: RedeemGiftCardParams): Promise<void> {
  const card = await client.query<{ id: string; balance: string; status: string }>(
    `SELECT id, balance, status FROM gift_cards WHERE company_id = $1 AND card_number = $2 FOR UPDATE`,
    [p.companyId, p.cardNumber],
  );
  if (card.rows.length === 0) {
    throw new NotFoundError(`no gift card found with number ${p.cardNumber}`);
  }
  const c = card.rows[0]!;
  if (c.status !== "active") {
    throw new BusinessRuleError(`gift card ${p.cardNumber} is ${c.status}, not active`);
  }
  if (Number(c.balance) < p.amount) {
    throw new BusinessRuleError(`gift card ${p.cardNumber} has insufficient balance (${c.balance} available, ${p.amount} requested)`);
  }

  const newBalance = Math.round((Number(c.balance) - p.amount + Number.EPSILON) * 100) / 100;
  await client.query(`UPDATE gift_cards SET balance = $2, status = $3 WHERE id = $1`, [
    c.id,
    newBalance,
    newBalance === 0 ? "redeemed" : "active",
  ]);
  await client.query(
    `INSERT INTO gift_card_transactions (company_id, gift_card_id, transaction_type, amount, balance_after, sales_invoice_id, created_by)
     VALUES ($1, $2, 'redeem', $3, $4, $5, $6)`,
    [p.companyId, c.id, -p.amount, newBalance, p.salesInvoiceId, p.redeemedBy],
  );
}
