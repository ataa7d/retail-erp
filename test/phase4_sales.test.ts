import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { newClient } from "./helpers.js";
import { createCreditNote, createSalesInvoice, postCreditNote, postSalesInvoice } from "../src/sales/salesService.js";

let client: Client;
let companyId: string;
let storeId: string;
let periodId: string;
let itemVariantId: string;
let customerId: string;
let userId: string;

async function account(code: string): Promise<string> {
  const r = await client.query<{ id: string }>(
    `SELECT id FROM chart_of_accounts WHERE company_id = $1 AND account_code = $2`,
    [companyId, code],
  );
  return r.rows[0]!.id;
}

beforeAll(async () => {
  client = newClient();
  await client.connect();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co P4', 'شركة') RETURNING id`,
    [`TEST_P4_${randomUUID().slice(0, 8)}`],
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

  const fy = await client.query(
    `INSERT INTO fiscal_years (company_id, year_name, start_date, end_date) VALUES ($1, 'FY2026', '2026-01-01', '2026-12-31') RETURNING id`,
    [companyId],
  );
  const period = await client.query(
    `INSERT INTO fiscal_periods (fiscal_year_id, company_id, period_number, start_date, end_date, status)
     VALUES ($1, $2, 3, '2026-03-01', '2026-03-31', 'open') RETURNING id`,
    [fy.rows[0].id, companyId],
  );
  periodId = period.rows[0].id;

  const groups: Array<[string, string]> = [
    ["1000", "asset,debit"],
    ["2000", "liability,credit"],
    ["4000", "revenue,credit"],
  ];
  const groupIds: Record<string, string> = {};
  for (const [code, spec] of groups) {
    const [type, bal] = spec.split(",");
    const r = await client.query(
      `INSERT INTO chart_of_accounts (company_id, account_code, name_en, name_ar, account_type, normal_balance, is_header)
       VALUES ($1, $2, $2, $2, $3, $4, true) RETURNING id`,
      [companyId, code, type, bal],
    );
    groupIds[code] = r.rows[0].id;
  }
  const leaves: Array<[string, string, string, string]> = [
    ["1110", "asset", "debit", "1000"],
    ["1120", "asset", "debit", "1000"],
    ["2110", "liability", "credit", "2000"],
    ["4110", "revenue", "credit", "4000"],
    ["4120", "revenue", "debit", "4000"],
  ];
  for (const [code, type, bal, parent] of leaves) {
    await client.query(
      `INSERT INTO chart_of_accounts (company_id, parent_id, account_code, name_en, name_ar, account_type, normal_balance)
       VALUES ($1, $2, $3, $3, $3, $4, $5)`,
      [companyId, groupIds[parent], code, type, bal],
    );
  }

  const item = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, 'IT-1', 'Test Item', 'صنف') RETURNING id`,
    [companyId],
  );
  const variant = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, 'SKU-1') RETURNING id`,
    [companyId, item.rows[0].id],
  );
  itemVariantId = variant.rows[0].id;

  const customer = await client.query(
    `INSERT INTO customers (company_id, customer_code, name_en, name_ar) VALUES ($1, 'C1', 'Customer 1', 'عميل 1') RETURNING id`,
    [companyId],
  );
  customerId = customer.rows[0].id;

  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, 'x', 'Test User', 'مستخدم') RETURNING id`,
    [`p4user_${randomUUID()}@test.local`],
  );
  userId = user.rows[0].id;
});

afterAll(async () => {
  await client.query(`SET app.bypass_immutability = 'true'`);
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM credit_note_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM credit_notes WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoice_payments WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoice_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoices WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journal_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journals WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_movements WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_balances WHERE company_id = $1`, [companyId]);
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

describe("POS invoice: create, post, and GL impact", () => {
  it("posts a mixed-VAT, mixed-payment invoice with a balanced, correct journal", async () => {
    const invoiceId = await createSalesInvoice(client, {
      companyId,
      storeId,
      invoiceChannel: "pos",
      zatcaInvoiceCategory: "simplified",
      invoiceDate: "2026-03-10",
      fiscalPeriodId: periodId,
      customerId,
      salespersonId: null,
      priceListId: null,
      createdBy: userId,
      lines: [
        { itemVariantId, itemDescription: "Item A", qty: 2, unitPrice: 57.5, discountAmount: 0, vatRate: 15, priceIncludesVat: true },
        { itemVariantId, itemDescription: "Item B", qty: 1, unitPrice: 42, discountAmount: 0, vatRate: 5, priceIncludesVat: true },
        { itemVariantId: null, itemDescription: "Delivery fee", lineType: "charge", qty: 1, unitPrice: 10, discountAmount: 0, vatRate: 0, priceIncludesVat: true },
      ],
      payments: [
        { paymentMethod: "cash", amount: 100 },
        { paymentMethod: "card", amount: 67 },
      ],
    });

    const before = await client.query(
      `SELECT net_amount, vat_amount, gross_amount, document_status FROM sales_invoices WHERE id = $1`,
      [invoiceId],
    );
    expect(before.rows[0].document_status).toBe("draft");
    // 115 (incl 15%) + 42 (incl 5%) + 10 (0%) = 167 gross total
    expect(Number(before.rows[0].gross_amount)).toBe(167);

    await postSalesInvoice(client, invoiceId, userId);

    const after = await client.query(
      `SELECT net_amount, vat_amount, gross_amount, document_status, journal_id FROM sales_invoices WHERE id = $1`,
      [invoiceId],
    );
    expect(after.rows[0].document_status).toBe("posted");
    expect(after.rows[0].journal_id).not.toBeNull();

    const journalId = after.rows[0].journal_id;
    const journalLines = await client.query(
      `SELECT account_id, debit_amount, credit_amount FROM journal_lines WHERE journal_id = $1`,
      [journalId],
    );

    const debitTotal = journalLines.rows.reduce((s, r) => s + Number(r.debit_amount), 0);
    const creditTotal = journalLines.rows.reduce((s, r) => s + Number(r.credit_amount), 0);
    expect(debitTotal).toBeCloseTo(creditTotal, 2);
    expect(debitTotal).toBeCloseTo(167, 2);

    const cashAccountId = await account("1110");
    const revenueAccountId = await account("4110");
    const vatAccountId = await account("2110");

    // cash and card are separate payment-method rows but both map to the
    // same cash/equivalents account, so they appear as two journal lines.
    const cashDebitTotal = journalLines.rows
      .filter((r) => r.account_id === cashAccountId)
      .reduce((s, r) => s + Number(r.debit_amount), 0);
    expect(cashDebitTotal).toBe(167); // 100 cash + 67 card

    const revenueLine = journalLines.rows.find((r) => r.account_id === revenueAccountId);
    expect(Number(revenueLine!.credit_amount)).toBe(Number(after.rows[0].net_amount));

    const vatLine = journalLines.rows.find((r) => r.account_id === vatAccountId);
    expect(Number(vatLine!.credit_amount)).toBe(Number(after.rows[0].vat_amount));
  });

  it("rejects posting when payments do not cover the total", async () => {
    const invoiceId = await createSalesInvoice(client, {
      companyId,
      storeId,
      invoiceChannel: "pos",
      zatcaInvoiceCategory: "simplified",
      invoiceDate: "2026-03-10",
      fiscalPeriodId: periodId,
      customerId: null,
      salespersonId: null,
      priceListId: null,
      createdBy: userId,
      lines: [{ itemVariantId, itemDescription: "Item A", qty: 1, unitPrice: 115, discountAmount: 0, vatRate: 15, priceIncludesVat: true }],
      payments: [{ paymentMethod: "cash", amount: 50 }],
    });

    await expect(postSalesInvoice(client, invoiceId, userId)).rejects.toThrow(/do not cover the total/);
  });

  it("keeps header totals equal to SUM(lines) at all times (rule C)", async () => {
    const invoiceId = await createSalesInvoice(client, {
      companyId,
      storeId,
      invoiceChannel: "pos",
      zatcaInvoiceCategory: "simplified",
      invoiceDate: "2026-03-10",
      fiscalPeriodId: periodId,
      customerId: null,
      salespersonId: null,
      priceListId: null,
      createdBy: userId,
      lines: [{ itemVariantId, itemDescription: "Item A", qty: 3, unitPrice: 10, discountAmount: 0, vatRate: 15, priceIncludesVat: true }],
      payments: [{ paymentMethod: "cash", amount: 30 }],
    });

    // Add another line directly and confirm the header auto-recomputes.
    await client.query(
      `INSERT INTO sales_invoice_lines
         (company_id, invoice_id, line_number, item_variant_id, item_description, qty, unit_price,
          discount_amount, vat_rate, price_includes_vat, net_amount, vat_amount, gross_amount)
       VALUES ($1, $2, 2, $3, 'extra', 1, 11.5, 0, 15, true, 10, 1.5, 11.5)`,
      [companyId, invoiceId, itemVariantId],
    );

    const lines = await client.query(
      `SELECT COALESCE(SUM(net_amount),0) AS net, COALESCE(SUM(vat_amount),0) AS vat, COALESCE(SUM(gross_amount),0) AS gross
       FROM sales_invoice_lines WHERE invoice_id = $1`,
      [invoiceId],
    );
    const header = await client.query(
      `SELECT net_amount, vat_amount, gross_amount FROM sales_invoices WHERE id = $1`,
      [invoiceId],
    );

    expect(Number(header.rows[0].net_amount)).toBe(Number(lines.rows[0].net));
    expect(Number(header.rows[0].vat_amount)).toBe(Number(lines.rows[0].vat));
    expect(Number(header.rows[0].gross_amount)).toBe(Number(lines.rows[0].gross));
  });
});

describe("wholesale invoice: exclusive pricing, credit sale", () => {
  it("debits Accounts Receivable for the full gross amount", async () => {
    const invoiceId = await createSalesInvoice(client, {
      companyId,
      storeId,
      invoiceChannel: "wholesale",
      zatcaInvoiceCategory: "standard",
      invoiceDate: "2026-03-12",
      fiscalPeriodId: periodId,
      customerId,
      salespersonId: null,
      priceListId: null,
      createdBy: userId,
      lines: [{ itemVariantId, itemDescription: "Bulk order", qty: 10, unitPrice: 43.5, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });

    await postSalesInvoice(client, invoiceId, userId);

    const invoice = await client.query(`SELECT gross_amount, journal_id FROM sales_invoices WHERE id = $1`, [invoiceId]);
    expect(Number(invoice.rows[0].gross_amount)).toBe(500.25);

    const arAccountId = await account("1120");
    const arLine = await client.query(
      `SELECT debit_amount FROM journal_lines WHERE journal_id = $1 AND account_id = $2`,
      [invoice.rows[0].journal_id, arAccountId],
    );
    expect(Number(arLine.rows[0].debit_amount)).toBe(500.25);
  });
});

describe("posted invoice immutability", () => {
  it("rejects editing lines after posting", async () => {
    const invoiceId = await createSalesInvoice(client, {
      companyId,
      storeId,
      invoiceChannel: "pos",
      zatcaInvoiceCategory: "simplified",
      invoiceDate: "2026-03-10",
      fiscalPeriodId: periodId,
      customerId: null,
      salespersonId: null,
      priceListId: null,
      createdBy: userId,
      lines: [{ itemVariantId, itemDescription: "Item A", qty: 1, unitPrice: 23, discountAmount: 0, vatRate: 15, priceIncludesVat: true }],
      payments: [{ paymentMethod: "cash", amount: 23 }],
    });
    await postSalesInvoice(client, invoiceId, userId);

    await expect(
      client.query(`UPDATE sales_invoice_lines SET qty = 5 WHERE invoice_id = $1 AND line_number = 1`, [invoiceId]),
    ).rejects.toThrow(/immutable/);
  });
});

describe("credit notes: partial returns", () => {
  it("recalculates fresh from its own qty and rejects exceeding the sold quantity", async () => {
    const invoiceId = await createSalesInvoice(client, {
      companyId,
      storeId,
      invoiceChannel: "pos",
      zatcaInvoiceCategory: "simplified",
      invoiceDate: "2026-03-10",
      fiscalPeriodId: periodId,
      customerId,
      salespersonId: null,
      priceListId: null,
      createdBy: userId,
      lines: [{ itemVariantId, itemDescription: "Item A", qty: 7, unitPrice: 10.06, discountAmount: 0, vatRate: 15, priceIncludesVat: true }],
      payments: [{ paymentMethod: "cash", amount: 70.42 }],
    });
    await postSalesInvoice(client, invoiceId, userId);

    const sourceLine = await client.query(
      `SELECT id, net_amount, vat_amount FROM sales_invoice_lines WHERE invoice_id = $1 AND line_number = 1`,
      [invoiceId],
    );
    const sourceLineId = sourceLine.rows[0].id;

    const creditNoteId = await createCreditNote(client, {
      companyId,
      storeId,
      originalInvoiceId: invoiceId,
      zatcaInvoiceCategory: "simplified",
      creditNoteDate: "2026-03-15",
      fiscalPeriodId: periodId,
      customerId,
      reason: "Customer changed mind",
      createdBy: userId,
      lines: [
        {
          sourceLineId,
          itemVariantId,
          itemDescription: "Item A",
          qty: 2,
          unitPrice: 10.06,
          discountAmount: 0,
          vatRate: 15,
          priceIncludesVat: true,
        },
      ],
    });

    const cnLine = await client.query(
      `SELECT net_amount, vat_amount, gross_amount FROM credit_note_lines WHERE credit_note_id = $1`,
      [creditNoteId],
    );
    // Fresh recompute for qty=2 at 10.06, NOT (sourceLine.net * 2/7).
    expect(Number(cnLine.rows[0].net_amount)).toBe(17.5);
    expect(Number(cnLine.rows[0].vat_amount)).toBe(2.62);
    const scaledWrong = Math.round((Number(sourceLine.rows[0].net_amount) * 2 * 100) / 7) / 100;
    expect(Number(cnLine.rows[0].net_amount)).not.toBe(scaledWrong);

    await postCreditNote(client, creditNoteId, userId);

    const cn = await client.query(`SELECT document_status, journal_id, gross_amount FROM credit_notes WHERE id = $1`, [creditNoteId]);
    expect(cn.rows[0].document_status).toBe("posted");

    const journalLines = await client.query(
      `SELECT account_id, debit_amount, credit_amount FROM journal_lines WHERE journal_id = $1`,
      [cn.rows[0].journal_id],
    );
    const debitTotal = journalLines.rows.reduce((s, r) => s + Number(r.debit_amount), 0);
    const creditTotal = journalLines.rows.reduce((s, r) => s + Number(r.credit_amount), 0);
    expect(debitTotal).toBeCloseTo(creditTotal, 2);
    expect(creditTotal).toBeCloseTo(Number(cn.rows[0].gross_amount), 2);

    // A second credit note trying to return the remaining 5 + 1 extra = 6 (only 5 left) must fail at posting.
    const secondCreditNoteId = await createCreditNote(client, {
      companyId,
      storeId,
      originalInvoiceId: invoiceId,
      zatcaInvoiceCategory: "simplified",
      creditNoteDate: "2026-03-16",
      fiscalPeriodId: periodId,
      customerId,
      reason: "second attempt",
      createdBy: userId,
      lines: [
        {
          sourceLineId,
          itemVariantId,
          itemDescription: "Item A",
          qty: 6,
          unitPrice: 10.06,
          discountAmount: 0,
          vatRate: 15,
          priceIncludesVat: true,
        },
      ],
    });

    await expect(postCreditNote(client, secondCreditNoteId, userId)).rejects.toThrow(/exceed quantity sold/);
  });
});
