import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import type { FastifyInstance } from "fastify";
import { newClient } from "./helpers.js";
import { buildApp } from "../src/api/app.js";
import { createSalesInvoice, postSalesInvoice, createCreditNote, postCreditNote } from "../src/sales/salesService.js";
import {
  createPurchaseOrder,
  postPurchaseOrder,
  createGoodsReceipt,
  postGoodsReceipt,
  createSupplierInvoice,
  postSupplierInvoice,
} from "../src/purchasing/purchasingService.js";

let client: Client;
let app: FastifyInstance;
let companyId: string;
let storeId: string;
let supplierId: string;
let customerId: string;
let itemVariantId: string;
let periodId: string;
let userId: string;
let authToken: string;

const PASSWORD = "TestPass123!";

beforeAll(async () => {
  client = newClient();
  await client.connect();
  app = await buildApp();
  await app.ready();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co VAT', 'شركة') RETURNING id`,
    [`TEST_VAT_${randomUUID().slice(0, 8)}`],
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

  const supplier = await client.query(
    `INSERT INTO suppliers (company_id, supplier_code, name_en, name_ar) VALUES ($1, 'SUP1', 'Supplier 1', 'مورد 1') RETURNING id`,
    [companyId],
  );
  supplierId = supplier.rows[0].id;

  const customer = await client.query(
    `INSERT INTO customers (company_id, customer_code, name_en, name_ar, payment_terms_days) VALUES ($1, 'C1', 'Customer 1', 'عميل 1', 30) RETURNING id`,
    [companyId],
  );
  customerId = customer.rows[0].id;

  const item = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, 'IT-VAT', 'VAT Item', 'صنف') RETURNING id`,
    [companyId],
  );
  const variant = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, 'SKU-VAT') RETURNING id`,
    [companyId, item.rows[0].id],
  );
  itemVariantId = variant.rows[0].id;

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
    ["1130", "asset", "debit", "1000"],
    ["1140", "asset", "debit", "1000"],
    ["2110", "liability", "credit", "2000"],
    ["2120", "liability", "credit", "2000"],
    ["2130", "liability", "credit", "2000"],
    ["2140", "liability", "credit", "2000"],
    ["4110", "revenue", "credit", "4000"],
    ["4120", "revenue", "debit", "4000"],
    ["5120", "expense", "debit", "5000"],
  ];
  for (const [code, type, bal, parent] of leaves) {
    await client.query(
      `INSERT INTO chart_of_accounts (company_id, parent_id, account_code, name_en, name_ar, account_type, normal_balance)
       VALUES ($1, $2, $3, $3, $3, $4, $5)`,
      [companyId, groupIds[parent], code, type, bal],
    );
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'VAT User', 'مستخدم') RETURNING id, email`,
    [`vatuser_${randomUUID()}@test.local`, passwordHash],
  );
  userId = user.rows[0].id;
  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [userId, companyId]);
  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Finance') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = 'accounting.reports.view'`,
    [role.rows[0].id],
  );
  await client.query(`INSERT INTO user_roles (user_id, company_id, role_id) VALUES ($1, $2, $3)`, [userId, companyId, role.rows[0].id]);

  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: user.rows[0].email, password: PASSWORD } });
  authToken = loginRes.json().token;

  // Output VAT: a wholesale sale for 1000 net @ 15% = 150 VAT, then a
  // credit note for 3 of the units (source line qty 10, credit 3 -> 300
  // net / 45 VAT) that must net the output side down.
  const invoiceId = await createSalesInvoice(client, {
    companyId, storeId, invoiceChannel: "wholesale", zatcaInvoiceCategory: "standard",
    invoiceDate: "2026-03-05", fiscalPeriodId: periodId, customerId, salespersonId: null, priceListId: null, createdBy: userId,
    lines: [{ itemVariantId, itemDescription: "Bulk", qty: 10, unitPrice: 100, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
  });
  await postSalesInvoice(client, invoiceId, userId);
  const sourceLine = await client.query(`SELECT id FROM sales_invoice_lines WHERE invoice_id = $1`, [invoiceId]);
  const creditNoteId = await createCreditNote(client, {
    companyId, storeId, originalInvoiceId: invoiceId, zatcaInvoiceCategory: "standard",
    creditNoteDate: "2026-03-10", fiscalPeriodId: periodId, customerId, reason: "Damaged", createdBy: userId,
    lines: [{ sourceLineId: sourceLine.rows[0].id, itemVariantId, itemDescription: "Bulk", qty: 3, unitPrice: 100, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
  });
  await postCreditNote(client, creditNoteId, userId);

  // Input VAT: a PO -> GR -> supplier invoice for 500 net @ 15% = 75 VAT.
  const poId = await createPurchaseOrder(client, {
    companyId, storeId, supplierId, orderDate: "2026-03-01", fiscalPeriodId: periodId, createdBy: userId,
    lines: [{ itemVariantId, qty: 50, unitPrice: 10, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
  });
  await postPurchaseOrder(client, poId, userId);
  const poLine = await client.query(`SELECT id FROM purchase_order_lines WHERE purchase_order_id = $1`, [poId]);
  const receiptId = await createGoodsReceipt(client, {
    companyId, storeId, purchaseOrderId: poId, supplierId, receiptDate: "2026-03-05", fiscalPeriodId: periodId, createdBy: userId,
    lines: [{ purchaseOrderLineId: poLine.rows[0].id, itemVariantId, qtyReceived: 50 }],
  });
  await postGoodsReceipt(client, receiptId, userId);
  const grLine = await client.query(`SELECT id FROM goods_receipt_lines WHERE goods_receipt_id = $1`, [receiptId]);
  const supplierInvoiceId = await createSupplierInvoice(client, {
    companyId, supplierId, purchaseOrderId: poId, supplierInvoiceNumber: "SUP-INV-VAT-1",
    invoiceDate: "2026-03-08", fiscalPeriodId: periodId, createdBy: userId,
    lines: [{ goodsReceiptLineId: grLine.rows[0].id, itemVariantId, qty: 50, unitPrice: 10, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
  });
  await postSupplierInvoice(client, supplierInvoiceId, userId);
});

afterAll(async () => {
  await app.close();
  await client.query(`SET app.bypass_immutability = 'true'`);
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM supplier_invoice_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM supplier_invoices WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM import_documents WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM goods_receipt_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM goods_receipts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM purchase_order_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM purchase_orders WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM credit_note_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM credit_notes WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoice_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoices WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journal_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journals WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_movements WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_balances WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM supplier_item_prices WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_variants WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM items WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM customers WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM suppliers WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE email LIKE 'vatuser_%'`);
  await client.query(`DELETE FROM chart_of_accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("GET /reports/vat-summary", () => {
  it("nets output VAT against credit notes and totals input VAT from posted supplier invoices", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/reports/vat-summary?startDate=2026-01-01&endDate=2026-12-31",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    const rows: Array<{ direction: string; vat_rate: string; net_amount: string; vat_amount: string }> = res.json().rows;

    const output15 = rows.find((r) => r.direction === "output" && Number(r.vat_rate) === 15);
    // Sale: 1000 net / 150 VAT. Credit note: 300 net / 45 VAT. Net: 700 / 105.
    expect(Number(output15!.net_amount)).toBe(700);
    expect(Number(output15!.vat_amount)).toBe(105);

    const input15 = rows.find((r) => r.direction === "input" && Number(r.vat_rate) === 15);
    // Supplier invoice: 500 net / 75 VAT.
    expect(Number(input15!.net_amount)).toBe(500);
    expect(Number(input15!.vat_amount)).toBe(75);
  });

  it("excludes activity outside the requested date range", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/reports/vat-summary?startDate=2025-01-01&endDate=2025-12-31",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toHaveLength(0);
  });
});
