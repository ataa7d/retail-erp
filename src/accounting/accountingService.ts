/**
 * Accounting service: customer receipts / supplier payments (AR/AP
 * settlement with allocation to specific invoices), bank reconciliation,
 * and period/fiscal-year close.
 */

import type { Client } from "pg";

async function nextDocumentNumber(client: Client, companyId: string, documentType: string, fiscalYear: number, prefix: string) {
  const r = await client.query<{ fn_next_document_number: string }>(
    `SELECT fn_next_document_number($1, $2, $3, $4) AS fn_next_document_number`,
    [companyId, documentType, fiscalYear, prefix],
  );
  return r.rows[0]!.fn_next_document_number;
}

async function getAccountId(client: Client, companyId: string, code: string): Promise<string> {
  const r = await client.query<{ id: string }>(
    `SELECT id FROM chart_of_accounts WHERE company_id = $1 AND account_code = $2`,
    [companyId, code],
  );
  if (r.rows.length === 0) {
    throw new Error(`chart of accounts is missing required account ${code} for company ${companyId}`);
  }
  return r.rows[0]!.id;
}

// ---------------------------------------------------------------------------
// Customer receipts (AR settlement)
// ---------------------------------------------------------------------------

export interface CreateCustomerReceiptParams {
  companyId: string;
  customerId: string;
  bankAccountId?: string | null;
  receiptDate: string;
  fiscalPeriodId: string;
  paymentMethod: "cash" | "card" | "credit" | "points" | "gift_card";
  amount: number;
  reference?: string | null;
  createdBy?: string | null;
  allocations?: Array<{ salesInvoiceId: string; allocatedAmount: number }>;
}

export async function createCustomerReceipt(client: Client, p: CreateCustomerReceiptParams): Promise<string> {
  const fiscalYear = Number(p.receiptDate.slice(0, 4));
  const documentNumber = await nextDocumentNumber(client, p.companyId, "customer_receipt", fiscalYear, "CR-");

  const header = await client.query<{ id: string }>(
    `INSERT INTO customer_receipts
       (company_id, customer_id, bank_account_id, document_number, receipt_date, fiscal_period_id, payment_method, amount, reference, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [p.companyId, p.customerId, p.bankAccountId ?? null, documentNumber, p.receiptDate, p.fiscalPeriodId, p.paymentMethod, p.amount, p.reference ?? null, p.createdBy ?? null],
  );
  const receiptId = header.rows[0]!.id;

  for (const alloc of p.allocations ?? []) {
    await client.query(
      `INSERT INTO customer_receipt_allocations (company_id, customer_receipt_id, sales_invoice_id, allocated_amount)
       VALUES ($1, $2, $3, $4)`,
      [p.companyId, receiptId, alloc.salesInvoiceId, alloc.allocatedAmount],
    );
  }

  return receiptId;
}

export async function postCustomerReceipt(client: Client, receiptId: string, postedBy: string): Promise<void> {
  const receiptResult = await client.query(
    `SELECT company_id, bank_account_id, receipt_date, fiscal_period_id, amount FROM customer_receipts WHERE id = $1`,
    [receiptId],
  );
  if (receiptResult.rows.length === 0) throw new Error(`customer receipt ${receiptId} not found`);
  const receipt = receiptResult.rows[0]!;

  const cashOrBankAccountId = receipt.bank_account_id
    ? (await client.query<{ gl_account_id: string }>(`SELECT gl_account_id FROM bank_accounts WHERE id = $1`, [receipt.bank_account_id])).rows[0]!.gl_account_id
    : await getAccountId(client, receipt.company_id, "1110");
  const arAccountId = await getAccountId(client, receipt.company_id, "1120");

  const fiscalYear = Number(receipt.receipt_date.toISOString().slice(0, 4));
  const journalNumber = await nextDocumentNumber(client, receipt.company_id, "journal", fiscalYear, "GJ-");
  const journalResult = await client.query<{ id: string }>(
    `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type, source_id, created_by)
     VALUES ($1, $2, $3, $4, 'customer_receipt', $5, $6) RETURNING id`,
    [receipt.company_id, journalNumber, receipt.receipt_date, receipt.fiscal_period_id, receiptId, postedBy],
  );
  const journalId = journalResult.rows[0]!.id;

  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
     VALUES ($1, $2, 1, $3, $4, 'customer receipt')`,
    [receipt.company_id, journalId, cashOrBankAccountId, receipt.amount],
  );
  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
     VALUES ($1, $2, 2, $3, $4, 'accounts receivable settlement')`,
    [receipt.company_id, journalId, arAccountId, receipt.amount],
  );

  await client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journalId]);
  await client.query(
    `UPDATE customer_receipts SET document_status = 'posted', posted_by = $2, journal_id = $3 WHERE id = $1`,
    [receiptId, postedBy, journalId],
  );
}

// ---------------------------------------------------------------------------
// Supplier payments (AP settlement)
// ---------------------------------------------------------------------------

export interface CreateSupplierPaymentParams {
  companyId: string;
  supplierId: string;
  bankAccountId?: string | null;
  paymentDate: string;
  fiscalPeriodId: string;
  paymentMethod: "cash" | "card" | "credit" | "points" | "gift_card";
  amount: number;
  reference?: string | null;
  createdBy?: string | null;
  allocations?: Array<{ supplierInvoiceId: string; allocatedAmount: number }>;
}

export async function createSupplierPayment(client: Client, p: CreateSupplierPaymentParams): Promise<string> {
  const fiscalYear = Number(p.paymentDate.slice(0, 4));
  const documentNumber = await nextDocumentNumber(client, p.companyId, "supplier_payment", fiscalYear, "SP-");

  const header = await client.query<{ id: string }>(
    `INSERT INTO supplier_payments
       (company_id, supplier_id, bank_account_id, document_number, payment_date, fiscal_period_id, payment_method, amount, reference, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [p.companyId, p.supplierId, p.bankAccountId ?? null, documentNumber, p.paymentDate, p.fiscalPeriodId, p.paymentMethod, p.amount, p.reference ?? null, p.createdBy ?? null],
  );
  const paymentId = header.rows[0]!.id;

  for (const alloc of p.allocations ?? []) {
    await client.query(
      `INSERT INTO supplier_payment_allocations (company_id, supplier_payment_id, supplier_invoice_id, allocated_amount)
       VALUES ($1, $2, $3, $4)`,
      [p.companyId, paymentId, alloc.supplierInvoiceId, alloc.allocatedAmount],
    );
  }

  return paymentId;
}

export async function postSupplierPayment(client: Client, paymentId: string, postedBy: string): Promise<void> {
  const paymentResult = await client.query(
    `SELECT company_id, bank_account_id, payment_date, fiscal_period_id, amount FROM supplier_payments WHERE id = $1`,
    [paymentId],
  );
  if (paymentResult.rows.length === 0) throw new Error(`supplier payment ${paymentId} not found`);
  const payment = paymentResult.rows[0]!;

  const cashOrBankAccountId = payment.bank_account_id
    ? (await client.query<{ gl_account_id: string }>(`SELECT gl_account_id FROM bank_accounts WHERE id = $1`, [payment.bank_account_id])).rows[0]!.gl_account_id
    : await getAccountId(client, payment.company_id, "1110");
  const apAccountId = await getAccountId(client, payment.company_id, "2130");

  const fiscalYear = Number(payment.payment_date.toISOString().slice(0, 4));
  const journalNumber = await nextDocumentNumber(client, payment.company_id, "journal", fiscalYear, "GJ-");
  const journalResult = await client.query<{ id: string }>(
    `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type, source_id, created_by)
     VALUES ($1, $2, $3, $4, 'supplier_payment', $5, $6) RETURNING id`,
    [payment.company_id, journalNumber, payment.payment_date, payment.fiscal_period_id, paymentId, postedBy],
  );
  const journalId = journalResult.rows[0]!.id;

  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
     VALUES ($1, $2, 1, $3, $4, 'accounts payable settlement')`,
    [payment.company_id, journalId, apAccountId, payment.amount],
  );
  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
     VALUES ($1, $2, 2, $3, $4, 'supplier payment')`,
    [payment.company_id, journalId, cashOrBankAccountId, payment.amount],
  );

  await client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journalId]);
  await client.query(
    `UPDATE supplier_payments SET document_status = 'posted', posted_by = $2, journal_id = $3 WHERE id = $1`,
    [paymentId, postedBy, journalId],
  );
}

// ---------------------------------------------------------------------------
// Bank reconciliation
// ---------------------------------------------------------------------------

export async function matchBankStatementLine(client: Client, statementLineId: string, journalLineId: string): Promise<void> {
  await client.query(`UPDATE bank_statement_lines SET matched_journal_line_id = $2 WHERE id = $1`, [statementLineId, journalLineId]);
}

export interface CreateBankReconciliationParams {
  companyId: string;
  bankAccountId: string;
  statementDate: string;
  statementEndingBalance: number;
  statementLineIds: string[]; // the matched lines this reconciliation sweeps up
  createdBy?: string | null;
}

export async function createAndPostBankReconciliation(client: Client, p: CreateBankReconciliationParams, postedBy: string): Promise<string> {
  const header = await client.query<{ id: string }>(
    `INSERT INTO bank_reconciliations (company_id, bank_account_id, statement_date, statement_ending_balance, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [p.companyId, p.bankAccountId, p.statementDate, p.statementEndingBalance, p.createdBy ?? null],
  );
  const reconciliationId = header.rows[0]!.id;

  for (const lineId of p.statementLineIds) {
    await client.query(`UPDATE bank_statement_lines SET bank_reconciliation_id = $2 WHERE id = $1`, [lineId, reconciliationId]);
  }

  await client.query(
    `UPDATE bank_reconciliations SET document_status = 'posted', posted_by = $2 WHERE id = $1`,
    [reconciliationId, postedBy],
  );

  return reconciliationId;
}

// ---------------------------------------------------------------------------
// Period / fiscal year close
// ---------------------------------------------------------------------------

export async function closePeriod(client: Client, periodId: string, closedBy: string): Promise<void> {
  await client.query(`UPDATE fiscal_periods SET status = 'closed', closed_by = $2 WHERE id = $1`, [periodId, closedBy]);
}

export async function reopenPeriod(client: Client, periodId: string): Promise<void> {
  await client.query(`UPDATE fiscal_periods SET status = 'open' WHERE id = $1`, [periodId]);
}

/**
 * Generates closing entries zeroing every revenue/expense account with a
 * nonzero posted balance into Retained Earnings, posts that journal into
 * the fiscal year's LAST period (while it's still open — periods 1..N-1
 * must already be closed), then closes that last period and the fiscal
 * year itself. This ordering avoids needing a dedicated "period 13":
 * the closing journal is the final thing posted before the last regular
 * period locks.
 */
export async function closeFiscalYear(client: Client, fiscalYearId: string, closedBy: string): Promise<void> {
  const yearResult = await client.query(
    `SELECT company_id, end_date FROM fiscal_years WHERE id = $1`,
    [fiscalYearId],
  );
  if (yearResult.rows.length === 0) throw new Error(`fiscal year ${fiscalYearId} not found`);
  const companyId = yearResult.rows[0]!.company_id;

  const periods = await client.query<{ id: string; period_number: number; status: string }>(
    `SELECT id, period_number, status FROM fiscal_periods WHERE fiscal_year_id = $1 ORDER BY period_number`,
    [fiscalYearId],
  );
  if (periods.rows.length === 0) throw new Error(`fiscal year ${fiscalYearId} has no periods`);

  const lastPeriod = periods.rows[periods.rows.length - 1]!;
  const earlierOpen = periods.rows.slice(0, -1).filter((p) => p.status !== "closed");
  if (earlierOpen.length > 0) {
    throw new Error(`cannot close fiscal year ${fiscalYearId}: periods ${earlierOpen.map((p) => p.period_number).join(", ")} are not yet closed`);
  }
  if (lastPeriod.status !== "open") {
    throw new Error(`cannot close fiscal year ${fiscalYearId}: its last period is already closed (nothing left to post the closing journal into)`);
  }

  const balances = await client.query<{ account_id: string; account_type: string; net_debit: string }>(
    `SELECT coa.id AS account_id, coa.account_type,
            COALESCE(SUM(jl.debit_amount), 0) - COALESCE(SUM(jl.credit_amount), 0) AS net_debit
     FROM chart_of_accounts coa
     JOIN journal_lines jl ON jl.account_id = coa.id
     JOIN journals j ON j.id = jl.journal_id AND j.document_status = 'posted'
     WHERE coa.company_id = $1 AND coa.account_type IN ('revenue', 'expense')
     GROUP BY coa.id, coa.account_type
     HAVING COALESCE(SUM(jl.debit_amount), 0) - COALESCE(SUM(jl.credit_amount), 0) <> 0`,
    [companyId],
  );

  if (balances.rows.length > 0) {
    const retainedEarningsId = await getAccountId(client, companyId, "3100");
    const fiscalYearNum = Number(yearResult.rows[0]!.end_date.toISOString().slice(0, 4));
    const journalNumber = await nextDocumentNumber(client, companyId, "journal", fiscalYearNum, "GJ-");

    const journalResult = await client.query<{ id: string }>(
      `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type, source_id, created_by)
       VALUES ($1, $2, $3, $4, 'year_end_close', $5, $6) RETURNING id`,
      [companyId, journalNumber, yearResult.rows[0]!.end_date, lastPeriod.id, fiscalYearId, closedBy],
    );
    const journalId = journalResult.rows[0]!.id;

    let lineNumber = 0;
    let netIncome = 0;
    for (const row of balances.rows) {
      lineNumber += 1;
      const netDebit = Number(row.net_debit); // positive = debit-heavy (expenses), negative = credit-heavy (revenue)
      netIncome -= netDebit; // revenue (negative net_debit) adds to income; expense (positive) reduces it
      if (netDebit > 0) {
        // expense account has a debit balance -> credit it to zero, debit will land on retained earnings via the balancing line below
        await client.query(
          `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
           VALUES ($1, $2, $3, $4, $5, 'year-end close')`,
          [companyId, journalId, lineNumber, row.account_id, Math.abs(netDebit)],
        );
      } else {
        await client.query(
          `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
           VALUES ($1, $2, $3, $4, $5, 'year-end close')`,
          [companyId, journalId, lineNumber, row.account_id, Math.abs(netDebit)],
        );
      }
    }

    lineNumber += 1;
    const netIncomeRounded = Math.round((netIncome + Number.EPSILON) * 100) / 100;
    if (netIncomeRounded > 0) {
      await client.query(
        `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
         VALUES ($1, $2, $3, $4, $5, 'net income to retained earnings')`,
        [companyId, journalId, lineNumber, retainedEarningsId, netIncomeRounded],
      );
    } else if (netIncomeRounded < 0) {
      await client.query(
        `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
         VALUES ($1, $2, $3, $4, $5, 'net loss to retained earnings')`,
        [companyId, journalId, lineNumber, retainedEarningsId, Math.abs(netIncomeRounded)],
      );
    }

    await client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journalId]);
  }

  await client.query(`UPDATE fiscal_periods SET status = 'closed', closed_by = $2 WHERE id = $1`, [lastPeriod.id, closedBy]);
  await client.query(`UPDATE fiscal_years SET status = 'closed', closed_by = $2 WHERE id = $1`, [fiscalYearId, closedBy]);
}
