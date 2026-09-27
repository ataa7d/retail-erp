import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import type { FastifyInstance } from "fastify";
import { newClient } from "./helpers.js";
import { buildApp } from "../src/api/app.js";
import { issueGiftCard, redeemGiftCard } from "../src/sales/giftCardService.js";

let client: Client;
let app: FastifyInstance;
let companyId: string;
let storeId: string;
let customerId: string;
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

beforeAll(async () => {
  client = newClient();
  await client.connect();
  app = await buildApp();
  await app.ready();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co Gift', 'شركة') RETURNING id`,
    [`TEST_GIFT_${randomUUID().slice(0, 8)}`],
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
    `INSERT INTO customers (company_id, customer_code, name_en, name_ar) VALUES ($1, 'C1', 'Walk-in', 'نقدي') RETURNING id`,
    [companyId],
  );
  customerId = customer.rows[0].id;

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
    ["2150", "liability", "credit", "2000"],
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
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, 'IT-GIFT', 'Gift Item', 'صنف') RETURNING id`,
    [companyId],
  );
  const variant = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, 'SKU-GIFT') RETURNING id`,
    [companyId, item.rows[0].id],
  );
  itemVariantId = variant.rows[0].id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Gift User', 'مستخدم') RETURNING id, email`,
    [`giftuser_${randomUUID()}@test.local`, passwordHash],
  );
  userId = user.rows[0].id;

  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [userId, companyId]);
  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Gift Card Manager') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions WHERE code IN ('sales.gift_card.issue', 'sales.pos_invoice.create')`,
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
  await client.query(`DELETE FROM gift_card_transactions WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM gift_cards WHERE company_id = $1`, [companyId]);
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
  await client.query(`DELETE FROM users WHERE email LIKE 'giftuser_%'`);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("gift card service", () => {
  it("issuing a card books Dr Cash / Cr Gift Card Liability, not revenue", async () => {
    const cardId = await issueGiftCard(client, {
      companyId,
      storeId,
      cardNumber: `GC-${randomUUID().slice(0, 8)}`,
      initialValue: 200,
      paymentMethod: "cash",
      fiscalPeriodId: periodId,
      issueDate: "2026-03-01",
      issuedBy: userId,
    });
    const card = await client.query(`SELECT balance, status, journal_id FROM gift_cards WHERE id = $1`, [cardId]);
    expect(Number(card.rows[0].balance)).toBe(200);
    expect(card.rows[0].status).toBe("active");

    const totals = await journalTotals(card.rows[0].journal_id);
    expect(totals.debit).toBe(200);
    expect(totals.credit).toBe(200);

    const revenueLine = await client.query(
      `SELECT 1 FROM journal_lines jl JOIN chart_of_accounts coa ON coa.id = jl.account_id
       WHERE jl.journal_id = $1 AND coa.account_code = '4110'`,
      [card.rows[0].journal_id],
    );
    expect(revenueLine.rows).toHaveLength(0); // issuance must never touch revenue
  });

  it("rejects issuing a duplicate card number", async () => {
    const cardNumber = `GC-DUP-${randomUUID().slice(0, 8)}`;
    await issueGiftCard(client, {
      companyId, storeId, cardNumber, initialValue: 50, paymentMethod: "cash",
      fiscalPeriodId: periodId, issueDate: "2026-03-01", issuedBy: userId,
    });
    await expect(
      issueGiftCard(client, {
        companyId, storeId, cardNumber, initialValue: 50, paymentMethod: "cash",
        fiscalPeriodId: periodId, issueDate: "2026-03-01", issuedBy: userId,
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("rejects redeeming more than the card's balance, and rejects an unknown card", async () => {
    const cardNumber = `GC-BAL-${randomUUID().slice(0, 8)}`;
    await issueGiftCard(client, {
      companyId, storeId, cardNumber, initialValue: 30, paymentMethod: "cash",
      fiscalPeriodId: periodId, issueDate: "2026-03-01", issuedBy: userId,
    });
    await expect(
      redeemGiftCard(client, { companyId, cardNumber, amount: 31, salesInvoiceId: "00000000-0000-0000-0000-000000000000", redeemedBy: userId }),
    ).rejects.toThrow(/insufficient balance/);
    await expect(
      redeemGiftCard(client, { companyId, cardNumber: "NO-SUCH-CARD", amount: 1, salesInvoiceId: "00000000-0000-0000-0000-000000000000", redeemedBy: userId }),
    ).rejects.toThrow(/no gift card found/);
  });
});

describe("gift card HTTP routes and POS redemption", () => {
  it("issues via HTTP, looks up the balance, and redeems it as a POS payment method with the right GL treatment", async () => {
    const cardNumber = `GC-HTTP-${randomUUID().slice(0, 8)}`;
    const issue = await inject("POST", "/api/gift-cards", {
      storeId,
      cardNumber,
      initialValue: 75,
      paymentMethod: "cash",
      fiscalPeriodId: periodId,
      issueDate: "2026-03-01",
    });
    expect(issue.statusCode).toBe(201);
    const cardId = issue.json().id;

    const lookup = await inject("GET", `/api/gift-cards/lookup?cardNumber=${cardNumber}`);
    expect(lookup.statusCode).toBe(200);
    expect(Number(lookup.json().balance)).toBe(75);

    // Spend 40 of the 75 balance on a POS sale.
    const create = await inject("POST", "/api/sales-invoices", {
      storeId,
      invoiceChannel: "pos",
      zatcaInvoiceCategory: "simplified",
      invoiceDate: "2026-03-05",
      fiscalPeriodId: periodId,
      customerId,
      lines: [{ itemVariantId, itemDescription: "Item", qty: 1, unitPrice: 40, discountAmount: 0, vatRate: 0, priceIncludesVat: true }],
      payments: [{ paymentMethod: "gift_card", amount: 40, reference: cardNumber }],
    });
    const invoiceId = create.json().id;
    const post = await inject("POST", `/api/sales-invoices/${invoiceId}/post`);
    expect(post.statusCode).toBe(200);

    const afterLookup = await inject("GET", `/api/gift-cards/lookup?cardNumber=${cardNumber}`);
    expect(Number(afterLookup.json().balance)).toBe(35); // 75 - 40

    const detail = await inject("GET", `/api/gift-cards/${cardId}`);
    expect(detail.json().transactions).toHaveLength(2); // issue + redeem
    const redeemTx = detail.json().transactions.find((t: { transaction_type: string }) => t.transaction_type === "redeem");
    expect(Number(redeemTx.amount)).toBe(-40);
    expect(redeemTx.sales_invoice_number).toBeTruthy();

    // The redemption must hit the gift card liability account, not cash --
    // it's drawing down a pre-existing liability, not new cash in.
    const invoice = await client.query(`SELECT journal_id FROM sales_invoices WHERE id = $1`, [invoiceId]);
    const liabilityLine = await client.query(
      `SELECT jl.debit_amount FROM journal_lines jl JOIN chart_of_accounts coa ON coa.id = jl.account_id
       WHERE jl.journal_id = $1 AND coa.account_code = '2150'`,
      [invoice.rows[0].journal_id],
    );
    expect(Number(liabilityLine.rows[0].debit_amount)).toBe(40);
    const cashLine = await client.query(
      `SELECT 1 FROM journal_lines jl JOIN chart_of_accounts coa ON coa.id = jl.account_id
       WHERE jl.journal_id = $1 AND coa.account_code = '1110'`,
      [invoice.rows[0].journal_id],
    );
    expect(cashLine.rows).toHaveLength(0); // no cash actually came in on this sale
  });

  it("fails to post a POS invoice that pays with an unknown gift card, leaving it a draft", async () => {
    const create = await inject("POST", "/api/sales-invoices", {
      storeId,
      invoiceChannel: "pos",
      zatcaInvoiceCategory: "simplified",
      invoiceDate: "2026-03-05",
      fiscalPeriodId: periodId,
      customerId,
      lines: [{ itemVariantId, itemDescription: "Item", qty: 1, unitPrice: 10, discountAmount: 0, vatRate: 0, priceIncludesVat: true }],
      payments: [{ paymentMethod: "gift_card", amount: 10, reference: "GC-NONEXISTENT" }],
    });
    const post = await inject("POST", `/api/sales-invoices/${create.json().id}/post`);
    expect(post.statusCode).toBe(404);

    const invoice = await client.query(`SELECT document_status FROM sales_invoices WHERE id = $1`, [create.json().id]);
    expect(invoice.rows[0].document_status).toBe("draft");
  });

  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/api/gift-cards" });
    expect(res.statusCode).toBe(401);
  });
});
