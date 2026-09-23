import "dotenv/config";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Client } from "pg";
import { newClient } from "./helpers.js";
import { buildApp } from "../src/api/app.js";

let app: FastifyInstance;
let client: Client;
let companyId: string;
let storeId: string;
let periodId: string;
let itemVariantId: string;
let customerId: string;
let userId: string;
let authToken: string;
let deviceId: string;

const PASSWORD = "TestPass123!";

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  client = newClient();
  await client.connect();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co P8', 'شركة') RETURNING id`,
    [`TEST_P8_${randomUUID().slice(0, 8)}`],
  );
  companyId = company.rows[0].id;

  const branch = await client.query(
    `INSERT INTO branches (company_id, branch_code, name_en, name_ar) VALUES ($1, 'HQ', 'HQ', 'المقر') RETURNING id`,
    [companyId],
  );
  const store = await client.query(
    `INSERT INTO stores (company_id, branch_id, store_code, name_en, name_ar) VALUES ($1, $2, 'ST1', 'Store 1', 'متجر 1') RETURNING id`,
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
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, 'IT-1', 'Item', 'صنف') RETURNING id`,
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

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'P8 Test User', 'مستخدم') RETURNING id`,
    [`p8user_${randomUUID()}@test.local`, passwordHash],
  );
  userId = user.rows[0].id;
  const userEmail = (await client.query(`SELECT email FROM users WHERE id = $1`, [userId])).rows[0].email;

  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [userId, companyId]);

  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Full Access') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions WHERE code IN ('sales.pos_invoice.create', 'sales.return.create', 'sales.pos_device.manage')`,
    [role.rows[0].id],
  );
  await client.query(`INSERT INTO user_roles (user_id, company_id, role_id) VALUES ($1, $2, $3)`, [userId, companyId, role.rows[0].id]);

  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: userEmail, password: PASSWORD } });
  authToken = loginRes.json().token;

  const registerRes = await app.inject({
    method: "POST",
    url: "/api/pos-devices",
    headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    payload: { storeId, deviceCode: "POS1", deviceName: "Till 1", seriesPrefix: "ST1-POS1-" },
  });
  expect(registerRes.statusCode).toBe(201);
  deviceId = registerRes.json().id;
});

afterAll(async () => {
  await app.close();
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
  await client.query(`DELETE FROM pos_device_sequences WHERE device_id IN (SELECT id FROM pos_devices WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM pos_devices WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
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

function invoicePayload(clientUuid: string, deviceSequenceNumber: number) {
  return {
    clientUuid,
    deviceSequenceNumber,
    storeId,
    zatcaInvoiceCategory: "simplified",
    invoiceDate: "2026-03-15",
    fiscalPeriodId: periodId,
    customerId,
    lines: [{ itemVariantId, itemDescription: "Item", qty: 1, unitPrice: 115, discountAmount: 0, vatRate: 15, priceIncludesVat: true }],
    payments: [{ paymentMethod: "cash", amount: 115 }],
  };
}

describe("pos device registration", () => {
  it("device's series prefix is permanent per company", async () => {
    const dupe = await app.inject({
      method: "POST",
      url: "/api/pos-devices",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { storeId, deviceCode: "POS1", deviceName: "Till 1 dupe", seriesPrefix: "ST1-POS1-" },
    });
    expect(dupe.statusCode).toBe(409);
  });

  it("lists devices with their sequence state", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/pos-devices",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    const device = res.json().find((d: { id: string }) => d.id === deviceId);
    expect(device).toBeDefined();
    expect(Number(device.last_synced_invoice_seq)).toBe(0);
  });
});

describe("sync push: invoices", () => {
  it("syncs an offline invoice: creates, posts, and assigns the device's permanent number", async () => {
    const clientUuid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/api/sync/push/invoices",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { deviceId, invoices: [invoicePayload(clientUuid, 1)] },
    });
    expect(res.statusCode).toBe(200);
    const [result] = res.json().results;
    expect(result.status).toBe("synced");
    expect(result.id).toBeDefined();

    const detail = await app.inject({
      method: "GET",
      url: `/api/sales-invoices/${result.id}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(detail.json().document_status).toBe("posted");
    expect(detail.json().document_number).toBe("ST1-POS1-INV-000001");

    // GL journal balances.
    const journal = await client.query(`SELECT journal_id FROM sales_invoices WHERE id = $1`, [result.id]);
    const lines = await client.query(`SELECT debit_amount, credit_amount FROM journal_lines WHERE journal_id = $1`, [
      journal.rows[0].journal_id,
    ]);
    const debit = lines.rows.reduce((s: number, r: { debit_amount: string }) => s + Number(r.debit_amount), 0);
    const credit = lines.rows.reduce((s: number, r: { credit_amount: string }) => s + Number(r.credit_amount), 0);
    expect(debit).toBe(credit);
  });

  it("retrying the same clientUuid is idempotent, not a duplicate", async () => {
    const clientUuid = randomUUID();
    const payload = { deviceId, invoices: [invoicePayload(clientUuid, 2)] };

    const first = await app.inject({
      method: "POST", url: "/api/sync/push/invoices",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload,
    });
    const firstId = first.json().results[0].id;
    expect(first.json().results[0].status).toBe("synced");

    const retry = await app.inject({
      method: "POST", url: "/api/sync/push/invoices",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload,
    });
    expect(retry.json().results[0].status).toBe("already_synced");
    expect(retry.json().results[0].id).toBe(firstId);

    const count = await client.query(`SELECT count(*) FROM sales_invoices WHERE client_uuid = $1`, [clientUuid]);
    expect(Number(count.rows[0].count)).toBe(1);
  });

  it("rejects a device_sequence_number that skips ahead (a gap), as a per-item error not a 500", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sync/push/invoices",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { deviceId, invoices: [invoicePayload(randomUUID(), 99)] },
    });
    expect(res.statusCode).toBe(200); // batch call itself succeeds; the item failed
    expect(res.json().results[0].status).toBe("error");
    expect(res.json().results[0].error).toMatch(/sequence out of order/);
  });

  it("processes a batch item-by-item: one bad record doesn't block a good one", async () => {
    const goodUuid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/api/sync/push/invoices",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: {
        deviceId,
        invoices: [
          invoicePayload(randomUUID(), 500), // gap -> error
          invoicePayload(goodUuid, 3), // correct next number -> synced
        ],
      },
    });
    expect(res.json().results[0].status).toBe("error");
    expect(res.json().results[1].status).toBe("synced");
  });

  it("rejects a device-issued invoice with zatca_invoice_category standard (cannot be issued offline)", async () => {
    const payload = invoicePayload(randomUUID(), 4);
    (payload as { zatcaInvoiceCategory: string }).zatcaInvoiceCategory = "standard";
    const res = await app.inject({
      method: "POST",
      url: "/api/sync/push/invoices",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { deviceId, invoices: [payload] },
    });
    expect(res.json().results[0].status).toBe("error");
    expect(res.json().results[0].error).toMatch(/cannot be issued offline/);
  });
});

describe("sync push: credit notes", () => {
  it("syncs an offline return against a previously synced offline invoice", async () => {
    // Sequence 4 is the correct next number here: 1, 2, and 3 were claimed by
    // earlier tests in this file, and the failed attempts at 99, 500, and 4
    // (standard-category, rejected by the DB trigger) all rolled back their
    // whole transaction, including the sequence claim itself — a rejected
    // sync must never advance the counter, or the device's next real
    // invoice would be permanently unable to sync (rule: a claim only
    // sticks if the document it belongs to actually commits).
    const invClientUuid = randomUUID();
    const invRes = await app.inject({
      method: "POST", url: "/api/sync/push/invoices",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { deviceId, invoices: [invoicePayload(invClientUuid, 4)] },
    });
    const invoiceId = invRes.json().results[0].id;

    const invDetail = await app.inject({
      method: "GET", url: `/api/sales-invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    const sourceLineId = invDetail.json().lines[0].id;

    const cnRes = await app.inject({
      method: "POST",
      url: "/api/sync/push/credit-notes",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: {
        deviceId,
        creditNotes: [
          {
            clientUuid: randomUUID(),
            deviceSequenceNumber: 1,
            storeId,
            originalInvoiceId: invoiceId,
            zatcaInvoiceCategory: "simplified",
            creditNoteDate: "2026-03-16",
            fiscalPeriodId: periodId,
            customerId,
            reason: "offline return",
            lines: [{ sourceLineId, itemVariantId, itemDescription: "Item", qty: 1, unitPrice: 115, discountAmount: 0, vatRate: 15, priceIncludesVat: true }],
          },
        ],
      },
    });
    expect(cnRes.statusCode).toBe(200);
    expect(cnRes.json().results[0].status).toBe("synced");

    const cnDetail = await app.inject({
      method: "GET", url: `/api/credit-notes/${cnRes.json().results[0].id}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(cnDetail.json().document_status).toBe("posted");
    expect(cnDetail.json().document_number).toBe("ST1-POS1-CN-000001");
  });
});

describe("sync pull", () => {
  it("returns master data and a labeled stock-balance snapshot for the store", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/sync/pull?storeId=${storeId}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.some((i: { id: string }) => i.id)).toBe(true);
    expect(body.customers.some((c: { id: string }) => c.id === customerId)).toBe(true);
    expect(body).toHaveProperty("stockBalances");
    expect(body).toHaveProperty("serverTime");
  });

  it("supports an updatedSince-style delta via since for items", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const res = await app.inject({
      method: "GET",
      url: `/api/sync/pull?storeId=${storeId}&since=${encodeURIComponent(future)}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBe(0);
  });
});
