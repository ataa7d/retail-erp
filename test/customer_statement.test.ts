import "dotenv/config";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import type { FastifyInstance } from "fastify";
import { newClient } from "./helpers.js";
import { buildApp } from "../src/api/app.js";
import { createCreditNote, createSalesInvoice, postCreditNote, postSalesInvoice } from "../src/sales/salesService.js";
import { createCustomerReceipt, postCustomerReceipt } from "../src/accounting/accountingService.js";

let client: Client;
let app: FastifyInstance;
let companyId: string;
let storeId: string;
let periodId: string;
let itemVariantId: string;
let customerId: string;
let userId: string;
let authToken: string;

const PASSWORD = "TestPass123!";

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
  app = await buildApp();
  await app.ready();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co Stmt', 'شركة') RETURNING id`,
    [`TEST_STMT_${randomUUID().slice(0, 8)}`],
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
    `INSERT INTO customers (company_id, customer_code, name_en, name_ar) VALUES ($1, 'C1', 'Statement Customer', 'عميل') RETURNING id`,
    [companyId],
  );
  customerId = customer.rows[0].id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Stmt User', 'مستخدم') RETURNING id, email`,
    [`stmtuser_${randomUUID()}@test.local`, passwordHash],
  );
  userId = user.rows[0].id;

  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [userId, companyId]);
  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Reports') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = 'accounting.reports.view'`,
    [role.rows[0].id],
  );
  await client.query(`INSERT INTO user_roles (user_id, company_id, role_id) VALUES ($1, $2, $3)`, [userId, companyId, role.rows[0].id]);

  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: user.rows[0].email, password: PASSWORD } });
  authToken = loginRes.json().token;
});

afterAll(async () => {
  await app.close();
  await client.query(`SET app.bypass_immutability = 'true'`);
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM customer_receipt_allocations WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM customer_receipts WHERE company_id = $1`, [companyId]);
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
  await client.query(`DELETE FROM user_roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.query(`DELETE FROM chart_of_accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("ar_open_items: a posted credit note against a wholesale invoice relieves AR", () => {
  it("reduces ar_ageing's open_amount by the credit note total", async () => {
    const invoiceId = await createSalesInvoice(client, {
      companyId, storeId, invoiceChannel: "wholesale", zatcaInvoiceCategory: "standard",
      invoiceDate: "2026-03-05", fiscalPeriodId: periodId, customerId, salespersonId: null, priceListId: null, createdBy: userId,
      lines: [{ itemVariantId, itemDescription: "Bulk", qty: 10, unitPrice: 20, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await postSalesInvoice(client, invoiceId, userId);
    // 10 * 20 * 1.15 = 230

    let ageing = await client.query(`SELECT open_amount FROM ar_ageing WHERE sales_invoice_id = $1`, [invoiceId]);
    expect(Number(ageing.rows[0].open_amount)).toBe(230);

    const sourceLine = await client.query(`SELECT id FROM sales_invoice_lines WHERE invoice_id = $1`, [invoiceId]);
    const creditNoteId = await createCreditNote(client, {
      companyId, storeId, originalInvoiceId: invoiceId, zatcaInvoiceCategory: "standard",
      creditNoteDate: "2026-03-08", fiscalPeriodId: periodId, customerId, reason: "Damaged goods", createdBy: userId,
      lines: [{ sourceLineId: sourceLine.rows[0].id, itemVariantId, itemDescription: "Bulk", qty: 3, unitPrice: 20, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await postCreditNote(client, creditNoteId, userId);
    // credit note: 3 * 20 * 1.15 = 69

    ageing = await client.query(`SELECT open_amount FROM ar_ageing WHERE sales_invoice_id = $1`, [invoiceId]);
    expect(Number(ageing.rows[0].open_amount)).toBe(161); // 230 - 69
  });

  it("does not touch AR for a credit note against a POS (cash) sale", async () => {
    const invoiceId = await createSalesInvoice(client, {
      companyId, storeId, invoiceChannel: "pos", zatcaInvoiceCategory: "simplified",
      invoiceDate: "2026-03-06", fiscalPeriodId: periodId, customerId, salespersonId: null, priceListId: null, createdBy: userId,
      lines: [{ itemVariantId, itemDescription: "Item", qty: 1, unitPrice: 100, discountAmount: 0, vatRate: 15, priceIncludesVat: true }],
      payments: [{ paymentMethod: "cash", amount: 100 }],
    });
    await postSalesInvoice(client, invoiceId, userId);

    // Fully cash-paid, no 'credit' portion -- never appears in ar_open_items at all.
    const ageing = await client.query(`SELECT open_amount FROM ar_ageing WHERE sales_invoice_id = $1`, [invoiceId]);
    expect(ageing.rows).toHaveLength(0);
  });
});

describe("GET /api/reports/customer-statement", () => {
  it("lists invoices, credit notes, and receipts in date order with a correct running and closing balance", async () => {
    const invoiceId = await createSalesInvoice(client, {
      companyId, storeId, invoiceChannel: "wholesale", zatcaInvoiceCategory: "standard",
      invoiceDate: "2026-03-10", fiscalPeriodId: periodId, customerId, salespersonId: null, priceListId: null, createdBy: userId,
      lines: [{ itemVariantId, itemDescription: "Order 1", qty: 5, unitPrice: 20, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await postSalesInvoice(client, invoiceId, userId); // +115.00

    const sourceLine = await client.query(`SELECT id FROM sales_invoice_lines WHERE invoice_id = $1`, [invoiceId]);
    const creditNoteId = await createCreditNote(client, {
      companyId, storeId, originalInvoiceId: invoiceId, zatcaInvoiceCategory: "standard",
      creditNoteDate: "2026-03-12", fiscalPeriodId: periodId, customerId, reason: "Return", createdBy: userId,
      lines: [{ sourceLineId: sourceLine.rows[0].id, itemVariantId, itemDescription: "Order 1", qty: 1, unitPrice: 20, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await postCreditNote(client, creditNoteId, userId); // -23.00

    const receiptId = await createCustomerReceipt(client, {
      companyId, customerId, bankAccountId: null, receiptDate: "2026-03-15", fiscalPeriodId: periodId,
      paymentMethod: "cash", amount: 50, createdBy: userId,
      allocations: [{ salesInvoiceId: invoiceId, allocatedAmount: 50 }],
    });
    await postCustomerReceipt(client, receiptId, userId); // -50.00

    const res = await app.inject({
      method: "GET",
      url: `/api/reports/customer-statement?customerId=${customerId}&startDate=2026-01-01&endDate=2026-03-31`,
      headers: { Authorization: `Bearer ${authToken}`, "X-Company-Id": companyId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Earlier describe blocks in this file already posted a wholesale
    // invoice (230) + credit note (-69) for the same customer, so this
    // statement carries that forward too: 161 (prior) + 115 - 23 - 50 = 203.
    expect(body.rows).toHaveLength(5);
    expect(body.rows.map((r: { document_type: string }) => r.document_type)).toEqual([
      "invoice", "credit_note", "invoice", "credit_note", "receipt",
    ]);
    expect(Number(body.openingBalance)).toBe(0);
    expect(Number(body.closingBalance)).toBe(203);
    expect(Number(body.rows[4].running_balance)).toBe(203);
  });

  it("carries a nonzero opening balance forward for a period that starts after earlier activity", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/reports/customer-statement?customerId=${customerId}&startDate=2026-03-13&endDate=2026-03-31`,
      headers: { Authorization: `Bearer ${authToken}`, "X-Company-Id": companyId },
    });
    const body = res.json();
    // Everything before 03-13 (161 from the ar_open_items describe block, plus this describe's own +115/-23) is folded into the opening balance.
    expect(Number(body.openingBalance)).toBe(253); // 161 + 115 - 23
    expect(body.rows).toHaveLength(1); // only the 03-15 receipt falls in this window
    expect(Number(body.closingBalance)).toBe(203);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: `/api/reports/customer-statement?customerId=${customerId}&startDate=2026-01-01&endDate=2026-03-31` });
    expect(res.statusCode).toBe(401);
  });
});
