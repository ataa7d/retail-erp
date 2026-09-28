import type { Client } from "pg";
import { BusinessRuleError, NotFoundError } from "../api/errors.js";
import { nextDocumentNumber, getAccountId } from "./salesService.js";

export interface RecordCustomerDepositParams {
  companyId: string;
  storeId: string;
  customerId: string;
  amount: number;
  paymentMethod: "cash" | "card";
  reference?: string | null;
  fiscalPeriodId: string;
  depositDate: string; // YYYY-MM-DD
  recordedBy: string | null;
}

// A deposit is not a sale -- it's cash received today against a promise to
// deliver merchandise (or issue a real invoice) later, so it books as a
// liability (2170), not revenue. Mirrors issueGiftCard exactly, except a
// deposit is tied to one specific customer rather than being a bearer
// instrument.
export async function recordCustomerDeposit(client: Client, p: RecordCustomerDepositParams): Promise<string> {
  const cashAccountId = await getAccountId(client, p.companyId, "1110");
  const liabilityAccountId = await getAccountId(client, p.companyId, "2170");

  const fiscalYear = Number(p.depositDate.slice(0, 4));
  const documentNumber = await nextDocumentNumber(client, p.companyId, "customer_deposit", fiscalYear, "DEP-");
  const journalNumber = await nextDocumentNumber(client, p.companyId, "journal", fiscalYear, "GJ-");

  const journal = await client.query<{ id: string }>(
    `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type, memo, created_by)
     VALUES ($1, $2, $3, $4, 'customer_deposit', $5, $6) RETURNING id`,
    [p.companyId, journalNumber, p.depositDate, p.fiscalPeriodId, `Customer deposit ${documentNumber}`, p.recordedBy],
  );
  const journalId = journal.rows[0]!.id;

  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
     VALUES ($1, $2, 1, $3, $4, $5)`,
    [p.companyId, journalId, cashAccountId, p.amount, `${p.paymentMethod} received for customer deposit`],
  );
  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
     VALUES ($1, $2, 2, $3, $4, 'customer deposit liability')`,
    [p.companyId, journalId, liabilityAccountId, p.amount],
  );
  await client.query(`UPDATE journals SET document_status = 'posted', posted_at = now(), posted_by = $2 WHERE id = $1`, [
    journalId,
    p.recordedBy,
  ]);

  const deposit = await client.query<{ id: string }>(
    `INSERT INTO customer_deposits (company_id, store_id, customer_id, document_number, reference, initial_value, balance, deposit_date, journal_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9) RETURNING id`,
    [p.companyId, p.storeId, p.customerId, documentNumber, p.reference ?? null, p.amount, p.depositDate, journalId, p.recordedBy],
  );
  const depositId = deposit.rows[0]!.id;

  await client.query(
    `INSERT INTO customer_deposit_transactions (company_id, customer_deposit_id, transaction_type, amount, balance_after, created_by)
     VALUES ($1, $2, 'deposit', $3, $3, $4)`,
    [p.companyId, depositId, p.amount, p.recordedBy],
  );

  return depositId;
}

export interface ApplyCustomerDepositParams {
  companyId: string;
  documentNumber: string;
  customerId: string;
  amount: number;
  salesInvoiceId: string;
  appliedBy: string | null;
}

// Called from salesService.postSalesInvoice for every payment row with
// payment_method = 'deposit', inside the same transaction as the invoice
// posting -- mirrors redeemGiftCard, plus a check that the invoice's own
// customer is the deposit's customer (a deposit isn't a bearer instrument
// like a gift card; it can't be applied to someone else's sale).
export async function applyCustomerDeposit(client: Client, p: ApplyCustomerDepositParams): Promise<void> {
  const deposit = await client.query<{ id: string; customer_id: string; status: string; balance: string }>(
    `SELECT id, customer_id, status, balance FROM customer_deposits WHERE company_id = $1 AND document_number = $2 FOR UPDATE`,
    [p.companyId, p.documentNumber],
  );
  if (deposit.rows.length === 0) {
    throw new NotFoundError(`no customer deposit found with number ${p.documentNumber}`);
  }
  const d = deposit.rows[0]!;
  if (d.customer_id !== p.customerId) {
    throw new BusinessRuleError(`deposit ${p.documentNumber} belongs to a different customer than this invoice`);
  }
  if (d.status !== "active") {
    throw new BusinessRuleError(`deposit ${p.documentNumber} is ${d.status}, not active`);
  }
  if (Number(d.balance) < p.amount) {
    throw new BusinessRuleError(`deposit ${p.documentNumber} has insufficient balance (${d.balance} available, ${p.amount} requested)`);
  }

  const newBalance = Math.round((Number(d.balance) - p.amount + Number.EPSILON) * 100) / 100;
  await client.query(`UPDATE customer_deposits SET balance = $2, status = $3 WHERE id = $1`, [
    d.id,
    newBalance,
    newBalance === 0 ? "consumed" : "active",
  ]);
  await client.query(
    `INSERT INTO customer_deposit_transactions (company_id, customer_deposit_id, transaction_type, amount, balance_after, sales_invoice_id, created_by)
     VALUES ($1, $2, 'apply', $3, $4, $5, $6)`,
    [p.companyId, d.id, -p.amount, newBalance, p.salesInvoiceId, p.appliedBy],
  );
}
