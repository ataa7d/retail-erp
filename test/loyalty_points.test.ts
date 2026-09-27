import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import type { FastifyInstance } from "fastify";
import { newClient } from "./helpers.js";
import { buildApp } from "../src/api/app.js";
import { earnLoyaltyPoints, redeemLoyaltyPoints } from "../src/sales/loyaltyService.js";

let client: Client;
let app: FastifyInstance;
let companyId: string;
let storeId: string;
let periodId: string;
let itemVariantId: string;
let userId: string;
let memberId: string;
let nonMemberId: string;
let authToken: string;
let dummyInvoiceId: string;

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

async function postedInvoice(customerId: string | null, unitPrice: number, paymentMethod: "cash" | "points" = "cash") {
  const create = await inject("POST", "/api/sales-invoices", {
    storeId,
    invoiceChannel: "pos",
    zatcaInvoiceCategory: "simplified",
    invoiceDate: "2026-03-05",
    fiscalPeriodId: periodId,
    customerId,
    lines: [{ itemVariantId, itemDescription: "Item", qty: 1, unitPrice, discountAmount: 0, vatRate: 0, priceIncludesVat: true }],
    payments: [{ paymentMethod, amount: unitPrice }],
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
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co Loyalty', 'شركة') RETURNING id`,
    [`TEST_LOY_${randomUUID().slice(0, 8)}`],
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

  const member = await client.query(
    `INSERT INTO customers (company_id, customer_code, name_en, name_ar, is_loyalty_member) VALUES ($1, 'C1', 'Member', 'عضو', true) RETURNING id`,
    [companyId],
  );
  memberId = member.rows[0].id;
  const nonMember = await client.query(
    `INSERT INTO customers (company_id, customer_code, name_en, name_ar) VALUES ($1, 'C2', 'Not A Member', 'غير عضو') RETURNING id`,
    [companyId],
  );
  nonMemberId = nonMember.rows[0].id;

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
    ["1120", "asset", "debit", "1000"],
    ["2110", "liability", "credit", "1000"],
    ["2160", "liability", "credit", "2000"],
    ["4110", "revenue", "credit", "4000"],
    ["5130", "expense", "debit", "5000"],
  ];
  for (const [code, type, bal, parent] of leaves) {
    await client.query(
      `INSERT INTO chart_of_accounts (company_id, parent_id, account_code, name_en, name_ar, account_type, normal_balance)
       VALUES ($1, $2, $3, $3, $3, $4, $5)`,
      [companyId, groupIds[parent] ?? groupIds["1000"], code, type, bal],
    );
  }

  const item = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, 'IT-LOY', 'Loyalty Item', 'صنف') RETURNING id`,
    [companyId],
  );
  const variant = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, 'SKU-LOY') RETURNING id`,
    [companyId, item.rows[0].id],
  );
  itemVariantId = variant.rows[0].id;

  // A dummy draft invoice, purely to satisfy loyalty_points_transactions'
  // FK on sales_invoice_id in the direct service-level tests below (the
  // HTTP tests use real posted invoices).
  const dummyInvoice = await client.query(
    `INSERT INTO sales_invoices (company_id, store_id, invoice_channel, zatca_invoice_category, document_number, invoice_date, fiscal_period_id, customer_id)
     VALUES ($1, $2, 'pos', 'simplified', 'DUMMY-0001', '2026-03-01', $3, $4) RETURNING id`,
    [companyId, storeId, periodId, memberId],
  );
  dummyInvoiceId = dummyInvoice.rows[0].id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Loyalty User', 'مستخدم') RETURNING id, email`,
    [`loyaltyuser_${randomUUID()}@test.local`, passwordHash],
  );
  userId = user.rows[0].id;

  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [userId, companyId]);
  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Loyalty Manager') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions WHERE code IN ('sales.pos_invoice.create', 'sales.customer.manage')`,
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
  await client.query(`DELETE FROM loyalty_points_transactions WHERE company_id = $1`, [companyId]);
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
  await client.query(`DELETE FROM users WHERE email LIKE 'loyaltyuser_%'`);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("loyalty points service", () => {
  it("earning books Dr Loyalty Program Expense / Cr Loyalty Points Liability", async () => {
    await earnLoyaltyPoints(client, {
      companyId, customerId: memberId, netAmount: 100, fiscalPeriodId: periodId,
      earnDate: "2026-03-01", salesInvoiceId: dummyInvoiceId, earnedBy: userId,
    });
    const customer = await client.query(`SELECT loyalty_points_balance FROM customers WHERE id = $1`, [memberId]);
    expect(customer.rows[0].loyalty_points_balance).toBe(10); // floor(100 * 0.1)

    const tx = await client.query(
      `SELECT journal_id, points, balance_after FROM loyalty_points_transactions WHERE customer_id = $1 AND transaction_type = 'earn'`,
      [memberId],
    );
    expect(tx.rows[0].points).toBe(10);
    const totals = await journalTotals(tx.rows[0].journal_id);
    expect(totals.debit).toBe(0.5); // 10 points * 0.05
    expect(totals.credit).toBe(0.5);
  });

  it("does nothing when the sale earns fewer than 1 point", async () => {
    const before = await client.query(`SELECT loyalty_points_balance FROM customers WHERE id = $1`, [memberId]);
    await earnLoyaltyPoints(client, {
      companyId, customerId: memberId, netAmount: 5, fiscalPeriodId: periodId, // floor(5*0.1) = 0
      earnDate: "2026-03-01", salesInvoiceId: dummyInvoiceId, earnedBy: userId,
    });
    const after = await client.query(`SELECT loyalty_points_balance FROM customers WHERE id = $1`, [memberId]);
    expect(after.rows[0].loyalty_points_balance).toBe(before.rows[0].loyalty_points_balance);
  });

  it("rejects redemption for a non-member and for insufficient balance", async () => {
    await expect(
      redeemLoyaltyPoints(client, { companyId, customerId: nonMemberId, amount: 0.05, salesInvoiceId: dummyInvoiceId, redeemedBy: userId }),
    ).rejects.toThrow(/not enrolled/);
    await expect(
      redeemLoyaltyPoints(client, { companyId, customerId: memberId, amount: 100, salesInvoiceId: dummyInvoiceId, redeemedBy: userId }),
    ).rejects.toThrow(/insufficient points balance/);
  });

  it("rejects a points amount that isn't a multiple of the point value", async () => {
    await expect(
      redeemLoyaltyPoints(client, { companyId, customerId: memberId, amount: 0.07, salesInvoiceId: dummyInvoiceId, redeemedBy: userId }),
    ).rejects.toThrow(/not a multiple/);
  });
});

describe("loyalty points via POS sale posting (HTTP)", () => {
  it("earns points automatically for an enrolled member's POS sale, not for a non-member", async () => {
    const beforeMember = (await client.query(`SELECT loyalty_points_balance FROM customers WHERE id = $1`, [memberId])).rows[0].loyalty_points_balance;

    const { post: memberPost } = await postedInvoice(memberId, 200);
    expect(memberPost.statusCode).toBe(200);
    const afterMember = (await client.query(`SELECT loyalty_points_balance FROM customers WHERE id = $1`, [memberId])).rows[0].loyalty_points_balance;
    expect(afterMember).toBe(beforeMember + 20); // floor(200 * 0.1)

    const { post: nonMemberPost } = await postedInvoice(nonMemberId, 200);
    expect(nonMemberPost.statusCode).toBe(200);
    const nonMemberBalance = await client.query(`SELECT loyalty_points_balance FROM customers WHERE id = $1`, [nonMemberId]);
    expect(nonMemberBalance.rows[0].loyalty_points_balance).toBe(0);
  });

  it("redeems points as a POS payment, hitting the liability account and not earning on the same sale", async () => {
    // Top up the member's balance first via a cash sale.
    await postedInvoice(memberId, 500); // +50 points
    const before = (await client.query(`SELECT loyalty_points_balance FROM customers WHERE id = $1`, [memberId])).rows[0].loyalty_points_balance;
    expect(before).toBeGreaterThanOrEqual(20);

    const { invoiceId, post } = await postedInvoice(memberId, 1, "points"); // pay 1.00 = 20 points
    expect(post.statusCode).toBe(200);

    const after = (await client.query(`SELECT loyalty_points_balance FROM customers WHERE id = $1`, [memberId])).rows[0].loyalty_points_balance;
    expect(after).toBe(before - 20); // spent 20 points, and this sale itself earns nothing (no double-dip)

    const invoice = await client.query(`SELECT journal_id FROM sales_invoices WHERE id = $1`, [invoiceId]);
    const liabilityLine = await client.query(
      `SELECT jl.debit_amount FROM journal_lines jl JOIN chart_of_accounts coa ON coa.id = jl.account_id
       WHERE jl.journal_id = $1 AND coa.account_code = '2160'`,
      [invoice.rows[0].journal_id],
    );
    expect(Number(liabilityLine.rows[0].debit_amount)).toBe(1);
    const cashLine = await client.query(
      `SELECT 1 FROM journal_lines jl JOIN chart_of_accounts coa ON coa.id = jl.account_id
       WHERE jl.journal_id = $1 AND coa.account_code = '1110'`,
      [invoice.rows[0].journal_id],
    );
    expect(cashLine.rows).toHaveLength(0);
  });

  it("fails to post when a non-member tries to pay with points", async () => {
    const { post } = await postedInvoice(nonMemberId, 1, "points");
    expect(post.statusCode).toBe(400);
  });

  it("enrolls a customer via the loyalty route and lists their transaction history", async () => {
    const newCustomer = await client.query(
      `INSERT INTO customers (company_id, customer_code, name_en, name_ar) VALUES ($1, 'C3', 'New Member', 'عضو جديد') RETURNING id`,
      [companyId],
    );
    const enroll = await inject("POST", `/api/customers/${newCustomer.rows[0].id}/loyalty`, {
      isLoyaltyMember: true,
      loyaltyCardNumber: "LC-0001",
    });
    expect(enroll.statusCode).toBe(200);

    const list = await inject("GET", "/api/customers");
    const row = list.json().find((c: { id: string }) => c.id === newCustomer.rows[0].id);
    expect(row.is_loyalty_member).toBe(true);
    expect(row.loyalty_card_number).toBe("LC-0001");

    const history = await inject("GET", `/api/customers/${memberId}/loyalty-transactions`);
    expect(history.statusCode).toBe(200);
    expect(history.json().length).toBeGreaterThan(0);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: `/api/customers/${memberId}/loyalty-transactions` });
    expect(res.statusCode).toBe(401);
  });
});
