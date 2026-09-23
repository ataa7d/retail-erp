import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { newClient } from "./helpers.js";
import { createSalesInvoice, postSalesInvoice } from "../src/sales/salesService.js";
import {
  createCustomerReceipt,
  postCustomerReceipt,
  createAndPostBankReconciliation,
  closePeriod,
  closeFiscalYear,
} from "../src/accounting/accountingService.js";

let client: Client;
let companyId: string;
let storeId: string;
let customerId: string;
let itemVariantId: string;
let bankAccountId: string;
let fiscalYearId: string;
let periods: Array<{ id: string; period_number: number }> = [];
let userId: string;

beforeAll(async () => {
  client = newClient();
  await client.connect();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co P7', 'شركة') RETURNING id`,
    [`TEST_P7_${randomUUID().slice(0, 8)}`],
  );
  companyId = company.rows[0].id;

  const branch = await client.query(
    `INSERT INTO branches (company_id, branch_code, name_en, name_ar) VALUES ($1, 'HQ', 'HQ', 'المقر') RETURNING id`,
    [companyId],
  );
  const store = await client.query(
    `INSERT INTO stores (company_id, branch_id, store_code, name_en, name_ar) VALUES ($1, $2, 'S1', 'Store 1', 'متجر 1') RETURNING id`,
    [companyId, branch.rows[0].id],
  );
  storeId = store.rows[0].id;

  const customer = await client.query(
    `INSERT INTO customers (company_id, customer_code, name_en, name_ar, payment_terms_days) VALUES ($1, 'C1', 'Customer 1', 'عميل 1', 30) RETURNING id`,
    [companyId],
  );
  customerId = customer.rows[0].id;

  const fy = await client.query(
    `INSERT INTO fiscal_years (company_id, year_name, start_date, end_date) VALUES ($1, 'FY2026', '2026-01-01', '2026-12-31') RETURNING id`,
    [companyId],
  );
  fiscalYearId = fy.rows[0].id;

  for (let m = 1; m <= 3; m++) {
    const start = new Date(Date.UTC(2026, m - 1, 1));
    const end = new Date(Date.UTC(2026, m, 0));
    const period = await client.query(
      `INSERT INTO fiscal_periods (fiscal_year_id, company_id, period_number, start_date, end_date, status)
       VALUES ($1, $2, $3, $4, $5, 'open') RETURNING id, period_number`,
      [fiscalYearId, companyId, m, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)],
    );
    periods.push(period.rows[0]);
  }

  const groups: Array<[string, string, string]> = [
    ["1000", "asset", "debit"],
    ["2000", "liability", "credit"],
    ["3000", "equity", "credit"],
    ["4000", "revenue", "credit"],
    ["5000", "expense", "debit"],
  ];
  const groupIds: Record<string, string> = {};
  for (const [code, type, bal] of groups) {
    const r = await client.query(
      `INSERT INTO chart_of_accounts (company_id, account_code, name_en, name_ar, account_type, normal_balance, is_header)
       VALUES ($1, $2, $2, $2, $3, $4, true) RETURNING id`,
      [companyId, code, type, bal],
    );
    groupIds[code] = r.rows[0].id;
  }
  const leaves: Array<[string, string, string, string]> = [
    ["1110", "asset", "debit", "1000"],
    ["1115", "asset", "debit", "1000"],
    ["1120", "asset", "debit", "1000"],
    ["1130", "asset", "debit", "1000"],
    ["2110", "liability", "credit", "2000"],
    ["3100", "equity", "credit", "3000"],
    ["4110", "revenue", "credit", "4000"],
    ["4120", "revenue", "debit", "4000"],
    ["5100", "expense", "debit", "5000"],
  ];
  const leafIds: Record<string, string> = {};
  for (const [code, type, bal, parent] of leaves) {
    const r = await client.query(
      `INSERT INTO chart_of_accounts (company_id, parent_id, account_code, name_en, name_ar, account_type, normal_balance)
       VALUES ($1, $2, $3, $3, $3, $4, $5) RETURNING id`,
      [companyId, groupIds[parent], code, type, bal],
    );
    leafIds[code] = r.rows[0].id;
  }

  const bankAccount = await client.query(
    `INSERT INTO bank_accounts (company_id, gl_account_id, bank_name, account_name) VALUES ($1, $2, 'Test Bank', 'Main') RETURNING id`,
    [companyId, leafIds["1115"]],
  );
  bankAccountId = bankAccount.rows[0].id;

  const item = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, 'IT-1', 'Item', 'صنف') RETURNING id`,
    [companyId],
  );
  const variant = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, 'SKU-1') RETURNING id`,
    [companyId, item.rows[0].id],
  );
  itemVariantId = variant.rows[0].id;

  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, 'x', 'Test User', 'مستخدم') RETURNING id`,
    [`p7user_${randomUUID()}@test.local`],
  );
  userId = user.rows[0].id;
});

afterAll(async () => {
  await client.query(`SET app.bypass_immutability = 'true'`);
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM bank_statement_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM bank_reconciliations WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM customer_receipt_allocations WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM customer_receipts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoice_payments WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoice_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoices WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journal_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journals WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_movements WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_balances WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM bank_accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_variants WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM items WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM customers WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM chart_of_accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("AR: customer receipts, allocation, and ageing", () => {
  it("posts a receipt, allocates it to an invoice, and the invoice drops off ar_ageing once fully paid", async () => {
    const invoiceId = await createSalesInvoice(client, {
      companyId, storeId, invoiceChannel: "wholesale", zatcaInvoiceCategory: "standard",
      invoiceDate: "2026-01-10", fiscalPeriodId: periods[0]!.id, customerId, salespersonId: null, priceListId: null,
      createdBy: userId,
      lines: [{ itemVariantId, itemDescription: "Item", qty: 1, unitPrice: 1000, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await postSalesInvoice(client, invoiceId, userId);

    let ageing = await client.query(`SELECT open_amount FROM ar_ageing WHERE sales_invoice_id = $1`, [invoiceId]);
    expect(Number(ageing.rows[0].open_amount)).toBe(1150);

    const receiptId = await createCustomerReceipt(client, {
      companyId, customerId, bankAccountId, receiptDate: "2026-01-20", fiscalPeriodId: periods[0]!.id,
      paymentMethod: "card", amount: 1150, createdBy: userId,
      allocations: [{ salesInvoiceId: invoiceId, allocatedAmount: 1150 }],
    });
    await postCustomerReceipt(client, receiptId, userId);

    const receipt = await client.query(`SELECT journal_id FROM customer_receipts WHERE id = $1`, [receiptId]);
    const lines = await client.query(`SELECT debit_amount, credit_amount FROM journal_lines WHERE journal_id = $1`, [receipt.rows[0].journal_id]);
    const debit = lines.rows.reduce((s, r) => s + Number(r.debit_amount), 0);
    const credit = lines.rows.reduce((s, r) => s + Number(r.credit_amount), 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(1150);

    ageing = await client.query(`SELECT open_amount FROM ar_ageing WHERE sales_invoice_id = $1`, [invoiceId]);
    expect(ageing.rows.length).toBe(0); // fully settled, drops off ageing
  });

  it("rejects an allocation that exceeds the invoice's remaining open amount", async () => {
    const invoiceId = await createSalesInvoice(client, {
      companyId, storeId, invoiceChannel: "wholesale", zatcaInvoiceCategory: "standard",
      invoiceDate: "2026-01-10", fiscalPeriodId: periods[0]!.id, customerId, salespersonId: null, priceListId: null,
      createdBy: userId,
      lines: [{ itemVariantId, itemDescription: "Item", qty: 1, unitPrice: 100, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await postSalesInvoice(client, invoiceId, userId);

    const receiptId = await createCustomerReceipt(client, {
      companyId, customerId, bankAccountId, receiptDate: "2026-01-20", fiscalPeriodId: periods[0]!.id,
      paymentMethod: "card", amount: 200, createdBy: userId,
    });

    await expect(
      client.query(
        `INSERT INTO customer_receipt_allocations (company_id, customer_receipt_id, sales_invoice_id, allocated_amount) VALUES ($1, $2, $3, $4)`,
        [companyId, receiptId, invoiceId, 200], // invoice gross is only 115
      ),
    ).rejects.toThrow(/exceed invoice/);
  });
});

describe("bank reconciliation", () => {
  it("matches a statement line to the receipt's journal line and posts when the total ties out", async () => {
    const invoiceId = await createSalesInvoice(client, {
      companyId, storeId, invoiceChannel: "wholesale", zatcaInvoiceCategory: "standard",
      invoiceDate: "2026-02-01", fiscalPeriodId: periods[1]!.id, customerId, salespersonId: null, priceListId: null,
      createdBy: userId,
      lines: [{ itemVariantId, itemDescription: "Item", qty: 1, unitPrice: 500, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await postSalesInvoice(client, invoiceId, userId);

    const receiptId = await createCustomerReceipt(client, {
      companyId, customerId, bankAccountId, receiptDate: "2026-02-05", fiscalPeriodId: periods[1]!.id,
      paymentMethod: "card", amount: 575, createdBy: userId,
    });
    await postCustomerReceipt(client, receiptId, userId);

    const receipt = await client.query(`SELECT journal_id FROM customer_receipts WHERE id = $1`, [receiptId]);
    const bankLine = await client.query(
      `SELECT jl.id FROM journal_lines jl JOIN bank_accounts ba ON ba.gl_account_id = jl.account_id
       WHERE jl.journal_id = $1 AND ba.id = $2`,
      [receipt.rows[0].journal_id, bankAccountId],
    );

    const statementLine = await client.query(
      `INSERT INTO bank_statement_lines (company_id, bank_account_id, statement_date, description, amount, matched_journal_line_id)
       VALUES ($1, $2, '2026-02-06', 'card settlement', 575, $3) RETURNING id`,
      [companyId, bankAccountId, bankLine.rows[0].id],
    );

    const reconciliationId = await createAndPostBankReconciliation(
      client,
      {
        companyId, bankAccountId, statementDate: "2026-02-06", statementEndingBalance: 575,
        statementLineIds: [statementLine.rows[0].id], createdBy: userId,
      },
      userId,
    );

    const reconciliation = await client.query(`SELECT document_status FROM bank_reconciliations WHERE id = $1`, [reconciliationId]);
    expect(reconciliation.rows[0].document_status).toBe("posted");

    const line = await client.query(`SELECT bank_reconciliation_id FROM bank_statement_lines WHERE id = $1`, [statementLine.rows[0].id]);
    expect(line.rows[0].bank_reconciliation_id).toBe(reconciliationId);
  });

  it("rejects a reconciliation whose matched total does not tie to the declared ending balance", async () => {
    const statementLine = await client.query(
      `INSERT INTO bank_statement_lines (company_id, bank_account_id, statement_date, description, amount)
       VALUES ($1, $2, '2026-02-10', 'unmatched deposit', 999) RETURNING id`,
      [companyId, bankAccountId],
    );

    await expect(
      createAndPostBankReconciliation(
        client,
        {
          companyId, bankAccountId, statementDate: "2026-02-10", statementEndingBalance: 1, // deliberately wrong
          statementLineIds: [statementLine.rows[0].id], createdBy: userId,
        },
        userId,
      ),
    ).rejects.toThrow(/does not match declared ending balance/);
  });
});

describe("period and fiscal year close", () => {
  it("rejects closing a period out of order", async () => {
    await expect(closePeriod(client, periods[1]!.id, userId)).rejects.toThrow(/earlier period/);
  });

  it("rejects closing a period with a draft journal still dated in it", async () => {
    await client.query(
      `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type)
       VALUES ($1, 'STRAY-DRAFT', '2026-01-15', $2, 'manual')`,
      [companyId, periods[0]!.id],
    );
    await expect(closePeriod(client, periods[0]!.id, userId)).rejects.toThrow(/draft journal/);

    await client.query(`SET app.bypass_immutability = 'true'`);
    await client.query(`DELETE FROM journals WHERE company_id = $1 AND journal_number = 'STRAY-DRAFT'`, [companyId]);
    await client.query(`SET app.bypass_immutability = 'false'`);
  });

  it("closes periods in order and rejects posting once closed", async () => {
    await closePeriod(client, periods[0]!.id, userId);
    const period0 = await client.query(`SELECT status, closed_at, closed_by FROM fiscal_periods WHERE id = $1`, [periods[0]!.id]);
    expect(period0.rows[0].status).toBe("closed");
    expect(period0.rows[0].closed_at).not.toBeNull();
    expect(period0.rows[0].closed_by).toBe(userId);

    await expect(
      createSalesInvoice(client, {
        companyId, storeId, invoiceChannel: "wholesale", zatcaInvoiceCategory: "standard",
        invoiceDate: "2026-01-25", fiscalPeriodId: periods[0]!.id, customerId, salespersonId: null, priceListId: null,
        createdBy: userId,
        lines: [{ itemVariantId, itemDescription: "Item", qty: 1, unitPrice: 10, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
      }).then((id) => postSalesInvoice(client, id, userId)),
    ).rejects.toThrow(/closed/);

    await closePeriod(client, periods[1]!.id, userId);
  });

  it("closes the fiscal year, generating a closing entry to Retained Earnings", async () => {
    // Post one more sale into the still-open period 3 so there's a nonzero
    // revenue/COGS balance for the closing entry to actually zero out.
    const invoiceId = await createSalesInvoice(client, {
      companyId, storeId, invoiceChannel: "wholesale", zatcaInvoiceCategory: "standard",
      invoiceDate: "2026-03-01", fiscalPeriodId: periods[2]!.id, customerId, salespersonId: null, priceListId: null,
      createdBy: userId,
      lines: [{ itemVariantId, itemDescription: "Item", qty: 1, unitPrice: 200, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await postSalesInvoice(client, invoiceId, userId);

    await closeFiscalYear(client, fiscalYearId, userId);

    const year = await client.query(`SELECT status, closed_at FROM fiscal_years WHERE id = $1`, [fiscalYearId]);
    expect(year.rows[0].status).toBe("closed");
    expect(year.rows[0].closed_at).not.toBeNull();

    const lastPeriod = await client.query(`SELECT status FROM fiscal_periods WHERE id = $1`, [periods[2]!.id]);
    expect(lastPeriod.rows[0].status).toBe("closed");

    const closingJournal = await client.query(
      `SELECT jl.debit_amount, jl.credit_amount, coa.account_code FROM journal_lines jl
       JOIN journals j ON j.id = jl.journal_id
       JOIN chart_of_accounts coa ON coa.id = jl.account_id
       WHERE j.source_type = 'year_end_close' AND j.company_id = $1`,
      [companyId],
    );
    expect(closingJournal.rows.length).toBeGreaterThan(0);

    const debitTotal = closingJournal.rows.reduce((s, r) => s + Number(r.debit_amount), 0);
    const creditTotal = closingJournal.rows.reduce((s, r) => s + Number(r.credit_amount), 0);
    expect(debitTotal).toBeCloseTo(creditTotal, 2);

    // Revenue account (4110) should have been debited to zero it out.
    const revenueLine = closingJournal.rows.find((r) => r.account_code === "4110");
    expect(revenueLine).toBeDefined();
    expect(Number(revenueLine!.debit_amount)).toBeGreaterThan(0);

    // Retained Earnings should carry the net income.
    const reLine = closingJournal.rows.find((r) => r.account_code === "3100");
    expect(reLine).toBeDefined();
  });
});
