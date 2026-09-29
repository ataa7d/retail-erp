import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import type { FastifyInstance } from "fastify";
import { newClient } from "./helpers.js";
import { buildApp } from "../src/api/app.js";
import { createSalesInvoice, postSalesInvoice } from "../src/sales/salesService.js";
import { createCustomerReceipt, postCustomerReceipt } from "../src/accounting/accountingService.js";

let client: Client;
let app: FastifyInstance;
let companyId: string;
let storeId: string;
let periodId: string;
let itemVariantId: string;
let limitedCustomerId: string;
let unlimitedCustomerId: string;
let userId: string;

const PASSWORD = "TestPass123!";

beforeAll(async () => {
  client = newClient();
  await client.connect();
  app = await buildApp();
  await app.ready();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co Credit', 'شركة') RETURNING id`,
    [`TEST_CRLM_${randomUUID().slice(0, 8)}`],
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
  ];
  for (const [code, type, bal, parent] of leaves) {
    await client.query(
      `INSERT INTO chart_of_accounts (company_id, parent_id, account_code, name_en, name_ar, account_type, normal_balance)
       VALUES ($1, $2, $3, $3, $3, $4, $5)`,
      [companyId, groupIds[parent], code, type, bal],
    );
  }

  const item = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, 'IT-CL', 'Credit Test Item', 'صنف') RETURNING id`,
    [companyId],
  );
  const variant = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, 'SKU-CL') RETURNING id`,
    [companyId, item.rows[0].id],
  );
  itemVariantId = variant.rows[0].id;

  const limited = await client.query(
    `INSERT INTO customers (company_id, customer_code, name_en, name_ar, credit_limit, payment_terms_days)
     VALUES ($1, 'CL1', 'Limited Customer', 'عميل محدود', 1000, 30) RETURNING id`,
    [companyId],
  );
  limitedCustomerId = limited.rows[0].id;
  const unlimited = await client.query(
    `INSERT INTO customers (company_id, customer_code, name_en, name_ar, payment_terms_days)
     VALUES ($1, 'CL2', 'Unlimited Customer', 'عميل غير محدود', 30) RETURNING id`,
    [companyId],
  );
  unlimitedCustomerId = unlimited.rows[0].id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Credit User', 'مستخدم') RETURNING id`,
    [`creditlimituser_${randomUUID()}@test.local`, passwordHash],
  );
  userId = user.rows[0].id;
});

afterAll(async () => {
  await app.close();
  await client.query(`SET app.bypass_immutability = 'true'`);
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM customer_receipt_allocations WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM customer_receipts WHERE company_id = $1`, [companyId]);
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

async function wholesaleInvoice(customerId: string, qty: number, unitPrice: number) {
  return createSalesInvoice(client, {
    companyId, storeId, invoiceChannel: "wholesale", zatcaInvoiceCategory: "standard",
    invoiceDate: "2026-03-05", fiscalPeriodId: periodId, customerId, salespersonId: null, priceListId: null, createdBy: userId,
    lines: [{ itemVariantId, itemDescription: "Bulk", qty, unitPrice, discountAmount: 0, vatRate: 0, priceIncludesVat: false }],
  });
}

let firstLimitedInvoiceId: string;

describe("credit limit enforcement", () => {
  it("posts a wholesale invoice within the customer's credit limit", async () => {
    const invoiceId = await wholesaleInvoice(limitedCustomerId, 10, 50); // 500
    firstLimitedInvoiceId = invoiceId;
    await expect(postSalesInvoice(client, invoiceId, userId)).resolves.toBeUndefined();
  });

  it("rejects a wholesale invoice that would push the customer over their credit limit", async () => {
    // Limited customer already has 500 open from the previous test; limit is 1000.
    const invoiceId = await wholesaleInvoice(limitedCustomerId, 20, 50); // 1000 more -> 1500 > 1000
    await expect(postSalesInvoice(client, invoiceId, userId)).rejects.toThrow(/over their credit limit/);

    const stillDraft = await client.query(`SELECT document_status FROM sales_invoices WHERE id = $1`, [invoiceId]);
    expect(stillDraft.rows[0].document_status).toBe("draft");
  });

  it("never blocks a customer with no credit limit configured, regardless of amount", async () => {
    const invoiceId = await wholesaleInvoice(unlimitedCustomerId, 1000, 500); // 500,000
    await expect(postSalesInvoice(client, invoiceId, userId)).resolves.toBeUndefined();
  });

  it("allows a new invoice again after a receipt pays down the customer's balance", async () => {
    // Limited customer is currently at 500 open (from the first test), limit 1000.
    const receiptId = await createCustomerReceipt(client, {
      companyId, customerId: limitedCustomerId, receiptDate: "2026-03-10", fiscalPeriodId: periodId,
      paymentMethod: "cash", amount: 500, createdBy: userId,
      allocations: [{ salesInvoiceId: firstLimitedInvoiceId, allocatedAmount: 500 }],
    });
    await postCustomerReceipt(client, receiptId, userId);

    const invoiceId = await wholesaleInvoice(limitedCustomerId, 20, 50); // 1000 -> back at exactly the limit
    await expect(postSalesInvoice(client, invoiceId, userId)).resolves.toBeUndefined();
  });
});
