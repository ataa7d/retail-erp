import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import type { FastifyInstance } from "fastify";
import { newClient } from "./helpers.js";
import { buildApp } from "../src/api/app.js";
import { recordCustomerDeposit, applyCustomerDeposit } from "../src/sales/customerDepositService.js";

let client: Client;
let app: FastifyInstance;
let companyId: string;
let storeId: string;
let customerAId: string;
let customerBId: string;
let periodId: string;
let itemVariantId: string;
let userId: string;
let authToken: string;

const PASSWORD = "TestPass123!";

async function inject(method: "GET" | "POST", url: string, body?: Record<string, unknown>) {
  return app.inject({
    method,
    url,
    headers: { Authorization: `Bearer ${authToken}`, "X-Company-Id": companyId },
    payload: body,
  });
}

async function journalTotals(journalId: string) {
  const r = await client.query(`SELECT debit_amount, credit_amount FROM journal_lines WHERE journal_id = $1`, [journalId]);
  const debit = r.rows.reduce((s, row) => s + Number(row.debit_amount), 0);
  const credit = r.rows.reduce((s, row) => s + Number(row.credit_amount), 0);
  return { debit, credit };
}

async function postedInvoice(customerId: string | null, unitPrice: number, paymentMethod: "cash" | "deposit" = "cash", reference?: string) {
  const create = await inject("POST", "/api/sales-invoices", {
    storeId,
    invoiceChannel: "pos",
    zatcaInvoiceCategory: "simplified",
    invoiceDate: "2026-03-05",
    fiscalPeriodId: periodId,
    customerId,
    lines: [{ itemVariantId, itemDescription: "Item", qty: 1, unitPrice, discountAmount: 0, vatRate: 0, priceIncludesVat: true }],
    payments: [{ paymentMethod, amount: unitPrice, reference }],
  });
  const invoiceId = create.json().id;
  const post = await inject("POST", `/api/sales-invoices/${invoiceId}/post`);
  return { invoiceId, post };
}

beforeAll(async () => {
  client = newClient();
  await client.connect();
  app = await buildApp();
  await app.ready();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co Deposit', 'شركة') RETURNING id`,
    [`TEST_DEP_${randomUUID().slice(0, 8)}`],
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

  const custA = await client.query(
    `INSERT INTO customers (company_id, customer_code, name_en, name_ar) VALUES ($1, 'C1', 'Customer A', 'عميل أ') RETURNING id`,
    [companyId],
  );
  customerAId = custA.rows[0].id;
  const custB = await client.query(
    `INSERT INTO customers (company_id, customer_code, name_en, name_ar) VALUES ($1, 'C2', 'Customer B', 'عميل ب') RETURNING id`,
    [companyId],
  );
  customerBId = custB.rows[0].id;

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

  const groups: Array<[string, string, string]> = [
    ["1000", "asset", "debit"],
    ["2000", "liability", "credit"],
    ["4000", "revenue", "credit"],
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
    ["1120", "asset", "debit", "1000"],
    ["2110", "liability", "credit", "1000"],
    ["2170", "liability", "credit", "2000"],
    ["4110", "revenue", "credit", "4000"],
  ];
  for (const [code, type, bal, parent] of leaves) {
    await client.query(
      `INSERT INTO chart_of_accounts (company_id, parent_id, account_code, name_en, name_ar, account_type, normal_balance)
       VALUES ($1, $2, $3, $3, $3, $4, $5)`,
      [companyId, groupIds[parent] ?? groupIds["1000"], code, type, bal],
    );
  }

  const item = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, 'IT-DEP', 'Deposit Item', 'صنف') RETURNING id`,
    [companyId],
  );
  const variant = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, 'SKU-DEP') RETURNING id`,
    [companyId, item.rows[0].id],
  );
  itemVariantId = variant.rows[0].id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Deposit User', 'مستخدم') RETURNING id, email`,
    [`deposituser_${randomUUID()}@test.local`, passwordHash],
  );
  userId = user.rows[0].id;

  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [userId, companyId]);
  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Deposit Manager') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions WHERE code IN ('sales.deposit.record', 'sales.pos_invoice.create')`,
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
  await client.query(`DELETE FROM customer_deposit_transactions WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM customer_deposits WHERE company_id = $1`, [companyId]);
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
  await client.query(`DELETE FROM user_roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE email LIKE 'deposituser_%'`);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("customer deposit service", () => {
  it("recording books Dr Cash / Cr Customer Deposits, not revenue", async () => {
    const depositId = await recordCustomerDeposit(client, {
      companyId, storeId, customerId: customerAId, amount: 300, paymentMethod: "cash",
      fiscalPeriodId: periodId, depositDate: "2026-03-01", recordedBy: userId,
    });
    const deposit = await client.query(`SELECT balance, status, journal_id, document_number FROM customer_deposits WHERE id = $1`, [depositId]);
    expect(Number(deposit.rows[0].balance)).toBe(300);
    expect(deposit.rows[0].status).toBe("active");
    expect(deposit.rows[0].document_number).toMatch(/^DEP-/);

    const totals = await journalTotals(deposit.rows[0].journal_id);
    expect(totals.debit).toBe(300);
    expect(totals.credit).toBe(300);

    const revenueLine = await client.query(
      `SELECT 1 FROM journal_lines jl JOIN chart_of_accounts coa ON coa.id = jl.account_id
       WHERE jl.journal_id = $1 AND coa.account_code = '4110'`,
      [deposit.rows[0].journal_id],
    );
    expect(revenueLine.rows).toHaveLength(0);
  });

  it("rejects applying a deposit to a different customer's invoice, and rejects over-applying", async () => {
    const depositId = await recordCustomerDeposit(client, {
      companyId, storeId, customerId: customerAId, amount: 50, paymentMethod: "cash",
      fiscalPeriodId: periodId, depositDate: "2026-03-01", recordedBy: userId,
    });
    const deposit = await client.query(`SELECT document_number FROM customer_deposits WHERE id = $1`, [depositId]);
    const docNumber = deposit.rows[0].document_number;

    await expect(
      applyCustomerDeposit(client, {
        companyId, documentNumber: docNumber, customerId: customerBId, amount: 10,
        salesInvoiceId: "00000000-0000-0000-0000-000000000000", appliedBy: userId,
      }),
    ).rejects.toThrow(/different customer/);

    await expect(
      applyCustomerDeposit(client, {
        companyId, documentNumber: docNumber, customerId: customerAId, amount: 51,
        salesInvoiceId: "00000000-0000-0000-0000-000000000000", appliedBy: userId,
      }),
    ).rejects.toThrow(/insufficient balance/);
  });
});

describe("customer deposits via POS sale posting (HTTP)", () => {
  it("records via HTTP, looks up the balance, and applies it as a POS payment with the right GL treatment", async () => {
    const record = await inject("POST", "/api/customer-deposits", {
      storeId,
      customerId: customerAId,
      amount: 75,
      paymentMethod: "cash",
      reference: "custom order #1",
      fiscalPeriodId: periodId,
      depositDate: "2026-03-01",
    });
    expect(record.statusCode).toBe(201);
    const depositId = record.json().id;
    const depositDetail = await inject("GET", `/api/customer-deposits/${depositId}`);
    const docNumber = depositDetail.json().document_number;

    const lookup = await inject("GET", `/api/customer-deposits/lookup?documentNumber=${docNumber}&customerId=${customerAId}`);
    expect(lookup.statusCode).toBe(200);
    expect(Number(lookup.json().balance)).toBe(75);

    const { invoiceId, post } = await postedInvoice(customerAId, 40, "deposit", docNumber);
    expect(post.statusCode).toBe(200);

    const afterLookup = await inject("GET", `/api/customer-deposits/lookup?documentNumber=${docNumber}&customerId=${customerAId}`);
    expect(Number(afterLookup.json().balance)).toBe(35); // 75 - 40

    const detail = await inject("GET", `/api/customer-deposits/${depositId}`);
    expect(detail.json().transactions).toHaveLength(2); // deposit + apply
    const applyTx = detail.json().transactions.find((t: { transaction_type: string }) => t.transaction_type === "apply");
    expect(Number(applyTx.amount)).toBe(-40);
    expect(applyTx.sales_invoice_number).toBeTruthy();

    // The application must hit the customer deposits liability account,
    // not cash -- it's drawing down a pre-existing liability.
    const invoice = await client.query(`SELECT journal_id FROM sales_invoices WHERE id = $1`, [invoiceId]);
    const liabilityLine = await client.query(
      `SELECT jl.debit_amount FROM journal_lines jl JOIN chart_of_accounts coa ON coa.id = jl.account_id
       WHERE jl.journal_id = $1 AND coa.account_code = '2170'`,
      [invoice.rows[0].journal_id],
    );
    expect(Number(liabilityLine.rows[0].debit_amount)).toBe(40);
    const cashLine = await client.query(
      `SELECT 1 FROM journal_lines jl JOIN chart_of_accounts coa ON coa.id = jl.account_id
       WHERE jl.journal_id = $1 AND coa.account_code = '1110'`,
      [invoice.rows[0].journal_id],
    );
    expect(cashLine.rows).toHaveLength(0);
  });

  it("fails to post a POS invoice that pays with an unknown deposit, leaving it a draft", async () => {
    const { post, invoiceId } = await postedInvoice(customerAId, 10, "deposit", "DEP-NONEXISTENT");
    expect(post.statusCode).toBe(404);
    const invoice = await client.query(`SELECT document_status FROM sales_invoices WHERE id = $1`, [invoiceId]);
    expect(invoice.rows[0].document_status).toBe("draft");
  });

  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/api/customer-deposits" });
    expect(res.statusCode).toBe(401);
  });
});
