import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import type { FastifyInstance } from "fastify";
import { newClient } from "./helpers.js";
import { buildApp } from "../src/api/app.js";

let client: Client;
let app: FastifyInstance;
let companyId: string;
let storeId: string;
let supplierId: string;
let periodId: string;
let authToken: string;
let variantId: string;

const PASSWORD = "TestPass123!";

async function inject(method: "GET" | "POST", url: string, body?: unknown) {
  return app.inject({
    method,
    url,
    headers: { Authorization: `Bearer ${authToken}`, "X-Company-Id": companyId },
    payload: body,
  });
}

beforeAll(async () => {
  client = newClient();
  await client.connect();
  app = await buildApp();
  await app.ready();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co Returns', 'شركة') RETURNING id`,
    [`TEST_RET_${randomUUID().slice(0, 8)}`],
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
    ["1130", "asset", "debit", "1000"],
    ["1140", "asset", "debit", "1000"],
    ["2120", "liability", "credit", "2000"],
    ["2130", "liability", "credit", "2000"],
    ["2140", "liability", "credit", "2000"],
    ["5120", "expense", "debit", "5000"],
  ];
  for (const [code, type, bal, parent] of leaves) {
    await client.query(
      `INSERT INTO chart_of_accounts (company_id, parent_id, account_code, name_en, name_ar, account_type, normal_balance)
       VALUES ($1, $2, $3, $3, $3, $4, $5)`,
      [companyId, groupIds[parent], code, type, bal],
    );
  }

  const item = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, 'IT-RET', 'Returnable Item', 'صنف') RETURNING id`,
    [companyId],
  );
  const variant = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, 'SKU-RET') RETURNING id`,
    [companyId, item.rows[0].id],
  );
  variantId = variant.rows[0].id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Returns User', 'مستخدم') RETURNING id, email`,
    [`retuser_${randomUUID()}@test.local`, passwordHash],
  );
  const userId = user.rows[0].id;

  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [userId, companyId]);
  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Purchasing') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions WHERE code IN ('purchasing.po.create', 'purchasing.goods_receipt.post')`,
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
  await client.query(`DELETE FROM supplier_credit_note_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM supplier_credit_notes WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM supplier_invoice_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM supplier_invoices WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM import_documents WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM goods_receipt_charges WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM goods_receipt_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM goods_receipts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM purchase_order_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM purchase_orders WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM supplier_item_prices WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journal_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journals WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_movements WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_balances WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_variants WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM items WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM suppliers WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM chart_of_accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE email LIKE 'retuser_%'`);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

async function postedInvoice(qty: number, unitPrice: number, ref: string) {
  const po = await inject("POST", "/api/purchase-orders", {
    storeId,
    supplierId,
    orderDate: "2026-03-01",
    fiscalPeriodId: periodId,
    lines: [{ itemVariantId: variantId, qty, unitPrice, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
  });
  const poId = po.json().id;
  await inject("POST", `/api/purchase-orders/${poId}/post`);
  const poDetail = (await inject("GET", `/api/purchase-orders/${poId}`)).json();
  const poLineId = poDetail.lines[0].id;

  const gr = await inject("POST", "/api/goods-receipts", {
    storeId,
    purchaseOrderId: poId,
    supplierId,
    receiptDate: "2026-03-05",
    fiscalPeriodId: periodId,
    lines: [{ purchaseOrderLineId: poLineId, itemVariantId: variantId, qtyReceived: qty }],
  });
  const grId = gr.json().id;
  await inject("POST", `/api/goods-receipts/${grId}/post`);
  const grDetail = (await inject("GET", `/api/goods-receipts/${grId}`)).json();
  const grLineId = grDetail.lines[0].id;

  const inv = await inject("POST", "/api/supplier-invoices", {
    supplierId,
    purchaseOrderId: poId,
    supplierInvoiceNumber: ref,
    invoiceDate: "2026-03-08",
    fiscalPeriodId: periodId,
    lines: [{ goodsReceiptLineId: grLineId, itemVariantId: variantId, qty, unitPrice, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
  });
  const invId = inv.json().id;
  await inject("POST", `/api/supplier-invoices/${invId}/post`);
  return invId;
}

describe("supplier credit notes (purchase returns) HTTP routes", () => {
  it("lists returnable lines for a posted invoice with the store id and full remaining qty", async () => {
    const invoiceId = await postedInvoice(20, 10, "SUP-INV-ROUTE-1");
    const res = await inject("GET", `/api/supplier-invoices/${invoiceId}/returnable-lines`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.storeId).toBe(storeId);
    expect(body.lines).toHaveLength(1);
    expect(Number(body.lines[0].returnable_qty)).toBe(20);
    expect(Number(body.lines[0].invoiced_qty)).toBe(20);
  });

  it("creates and posts a return, reducing the returnable qty and appearing in the list/detail endpoints", async () => {
    const invoiceId = await postedInvoice(10, 25, "SUP-INV-ROUTE-2");
    const returnable = (await inject("GET", `/api/supplier-invoices/${invoiceId}/returnable-lines`)).json();
    const line = returnable.lines[0];

    const create = await inject("POST", "/api/supplier-credit-notes", {
      storeId: returnable.storeId,
      supplierId,
      originalInvoiceId: invoiceId,
      creditNoteDate: "2026-03-10",
      fiscalPeriodId: periodId,
      reason: "wrong item shipped",
      lines: [
        {
          sourceLineId: line.source_line_id,
          itemVariantId: line.item_variant_id,
          qty: 4,
          unitPrice: Number(line.unit_price),
          discountAmount: 0,
          vatRate: Number(line.vat_rate),
          priceIncludesVat: line.price_includes_vat,
        },
      ],
    });
    expect(create.statusCode).toBe(201);
    const creditNoteId = create.json().id;

    const post = await inject("POST", `/api/supplier-credit-notes/${creditNoteId}/post`);
    expect(post.statusCode).toBe(200);
    expect(post.json().status).toBe("posted");

    const afterReturn = (await inject("GET", `/api/supplier-invoices/${invoiceId}/returnable-lines`)).json();
    expect(Number(afterReturn.lines[0].returnable_qty)).toBe(6); // 10 - 4

    const list = await inject("GET", "/api/supplier-credit-notes");
    expect(list.json().some((r: { id: string }) => r.id === creditNoteId)).toBe(true);

    const detail = await inject("GET", `/api/supplier-credit-notes/${creditNoteId}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().document_status).toBe("posted");
    expect(detail.json().lines).toHaveLength(1);
    expect(Number(detail.json().lines[0].qty)).toBe(4);
  });

  it("rejects returnable-lines for a draft (unposted) invoice", async () => {
    const po = await inject("POST", "/api/purchase-orders", {
      storeId,
      supplierId,
      orderDate: "2026-03-01",
      fiscalPeriodId: periodId,
      lines: [{ itemVariantId: variantId, qty: 5, unitPrice: 10, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await inject("POST", `/api/purchase-orders/${po.json().id}/post`);
    const poDetail = (await inject("GET", `/api/purchase-orders/${po.json().id}`)).json();
    const gr = await inject("POST", "/api/goods-receipts", {
      storeId,
      purchaseOrderId: po.json().id,
      supplierId,
      receiptDate: "2026-03-05",
      fiscalPeriodId: periodId,
      lines: [{ purchaseOrderLineId: poDetail.lines[0].id, itemVariantId: variantId, qtyReceived: 5 }],
    });
    await inject("POST", `/api/goods-receipts/${gr.json().id}/post`);
    const grDetail = (await inject("GET", `/api/goods-receipts/${gr.json().id}`)).json();

    const inv = await inject("POST", "/api/supplier-invoices", {
      supplierId,
      purchaseOrderId: po.json().id,
      supplierInvoiceNumber: "SUP-INV-DRAFT",
      invoiceDate: "2026-03-08",
      fiscalPeriodId: periodId,
      lines: [{ goodsReceiptLineId: grDetail.lines[0].id, itemVariantId: variantId, qty: 5, unitPrice: 10, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    // Deliberately not posted.

    const res = await inject("GET", `/api/supplier-invoices/${inv.json().id}/returnable-lines`);
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/api/supplier-credit-notes" });
    expect(res.statusCode).toBe(401);
  });
});
