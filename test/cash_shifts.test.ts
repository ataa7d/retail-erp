import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import type { FastifyInstance } from "fastify";
import { newClient } from "./helpers.js";
import { buildApp } from "../src/api/app.js";
import { createSalesInvoice, postSalesInvoice } from "../src/sales/salesService.js";
import { registerPosDevice } from "../src/sync/posDeviceService.js";
import { openCashShift, closeCashShift, computeZReport } from "../src/sales/cashShiftService.js";

let client: Client;
let app: FastifyInstance;
let companyId: string;
let storeId: string;
let deviceId: string;
let customerId: string;
let periodId: string;
let itemVariantId: string;
let userId: string;
let authToken: string;
let invoiceSeq = 0;

const PASSWORD = "TestPass123!";

async function postPosInvoice(payments: Array<{ paymentMethod: "cash" | "card"; amount: number }>, total: number) {
  invoiceSeq += 1;
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
    lines: [{ itemVariantId, itemDescription: "Item", qty: 1, unitPrice: total, discountAmount: 0, vatRate: 0, priceIncludesVat: true }],
    payments,
    documentNumberOverride: `TESTDEV-INV-${String(invoiceSeq).padStart(6, "0")}`,
    issuedByDeviceId: deviceId,
    deviceSequenceNumber: invoiceSeq,
  });
  await postSalesInvoice(client, invoiceId, userId);
  return invoiceId;
}

beforeAll(async () => {
  client = newClient();
  await client.connect();
  app = await buildApp();
  await app.ready();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co Shifts', 'شركة') RETURNING id`,
    [`TEST_SHIFT_${randomUUID().slice(0, 8)}`],
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
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, 'IT-SHIFT', 'Shift Item', 'صنف') RETURNING id`,
    [companyId],
  );
  const variant = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, 'SKU-SHIFT') RETURNING id`,
    [companyId, item.rows[0].id],
  );
  itemVariantId = variant.rows[0].id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Shift User', 'مستخدم') RETURNING id, email`,
    [`shiftuser_${randomUUID()}@test.local`, passwordHash],
  );
  userId = user.rows[0].id;

  deviceId = await registerPosDevice(client, {
    companyId,
    storeId,
    deviceCode: "DEV1",
    deviceName: "Test Register",
    seriesPrefix: "TESTDEV-",
    createdBy: userId,
  });

  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [userId, companyId]);
  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Cashier') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions WHERE code IN ('sales.cash_shift.open', 'sales.cash_shift.view')`,
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
  await client.query(`DELETE FROM cash_shifts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoice_payments WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoice_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoices WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journal_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journals WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM pos_device_sequences WHERE device_id = $1`, [deviceId]);
  await client.query(`DELETE FROM pos_devices WHERE company_id = $1`, [companyId]);
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
  await client.query(`DELETE FROM users WHERE email LIKE 'shiftuser_%'`);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("cash shift service", () => {
  it("rejects opening a second shift on a device that already has one open", async () => {
    const shiftId = await openCashShift(client, { companyId, storeId, deviceId, openingFloat: 200, openedBy: userId });
    await expect(openCashShift(client, { companyId, storeId, deviceId, openingFloat: 100, openedBy: userId })).rejects.toThrow(
      /already has an open cash shift/,
    );
    await closeCashShift(client, { shiftId, companyId, closingFloatCounted: 200, closedBy: userId });
  });

  it("computes expected cash and variance from posted cash sales during the shift window", async () => {
    const shiftId = await openCashShift(client, { companyId, storeId, deviceId, openingFloat: 100, openedBy: userId });
    await postPosInvoice([{ paymentMethod: "cash", amount: 50 }], 50);
    await postPosInvoice([{ paymentMethod: "card", amount: 30 }], 30);
    await postPosInvoice(
      [
        { paymentMethod: "cash", amount: 20 },
        { paymentMethod: "card", amount: 10 },
      ],
      30,
    );

    const report = await computeZReport(client, companyId, shiftId);
    expect(report.cashSalesTotal).toBe(70); // 50 + 20
    expect(report.expectedCash).toBe(170); // 100 opening + 70 cash
    expect(report.invoiceCount).toBe(3);
    expect(report.grossSalesTotal).toBe(110);
    const cardTotal = report.paymentTotals.find((p) => p.payment_method === "card");
    expect(Number(cardTotal?.total)).toBe(40); // 30 + 10

    await closeCashShift(client, { shiftId, companyId, closingFloatCounted: 165, closedBy: userId });
    const closedReport = await computeZReport(client, companyId, shiftId);
    expect(closedReport.status).toBe("closed");
    expect(closedReport.variance).toBe(-5); // counted 165 vs expected 170
  });

  it("rejects closing an already-closed shift", async () => {
    const shiftId = await openCashShift(client, { companyId, storeId, deviceId, openingFloat: 50, openedBy: userId });
    await closeCashShift(client, { shiftId, companyId, closingFloatCounted: 50, closedBy: userId });
    await expect(closeCashShift(client, { shiftId, companyId, closingFloatCounted: 50, closedBy: userId })).rejects.toThrow(
      /already closed/,
    );
  });
});

describe("cash shift HTTP routes", () => {
  async function inject(method: "GET" | "POST", url: string, body?: Record<string, unknown>) {
    return app.inject({
      method,
      url,
      headers: { Authorization: `Bearer ${authToken}`, "X-Company-Id": companyId },
      payload: body,
    });
  }

  it("opens, reports open shift via GET /cash-shifts/open, and closes with a Z-report", async () => {
    const open = await inject("POST", "/api/cash-shifts", { storeId, deviceId, openingFloat: 300 });
    expect(open.statusCode).toBe(201);
    const shiftId = open.json().id;

    const openLookup = await inject("GET", `/api/cash-shifts/open?deviceId=${deviceId}`);
    expect(openLookup.json().id).toBe(shiftId);

    const detail = await inject("GET", `/api/cash-shifts/${shiftId}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().status).toBe("open");

    const zReport = await inject("GET", `/api/cash-shifts/${shiftId}/z-report`);
    expect(zReport.statusCode).toBe(200);
    expect(Number(zReport.json().expectedCash)).toBe(300);

    const close = await inject("POST", `/api/cash-shifts/${shiftId}/close`, { closingFloatCounted: 300 });
    expect(close.statusCode).toBe(200);
    expect(close.json().status).toBe("closed");

    const afterClose = await inject("GET", `/api/cash-shifts/open?deviceId=${deviceId}`);
    expect(afterClose.json().id).toBe(null);

    const list = await inject("GET", "/api/cash-shifts");
    expect(list.json().some((r: { id: string }) => r.id === shiftId)).toBe(true);
  });

  it("rejects opening a second shift over HTTP with a clear error", async () => {
    const open = await inject("POST", "/api/cash-shifts", { storeId, deviceId, openingFloat: 100 });
    const second = await inject("POST", "/api/cash-shifts", { storeId, deviceId, openingFloat: 100 });
    expect(second.statusCode).toBe(400);
    await inject("POST", `/api/cash-shifts/${open.json().id}/close`, { closingFloatCounted: 100 });
  });

  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/api/cash-shifts" });
    expect(res.statusCode).toBe(401);
  });
});
