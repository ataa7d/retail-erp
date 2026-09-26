import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { newClient } from "./helpers.js";
import {
  createSalesQuotation,
  sendSalesQuotation,
  withdrawSalesQuotation,
  acceptSalesQuotation,
  rejectSalesQuotation,
  convertSalesQuotationToInvoice,
} from "../src/sales/salesService.js";

let client: Client;
let companyId: string;
let storeId: string;
let periodId: string;
let customerId: string;
let salespersonId: string;

async function newItemVariant(): Promise<string> {
  const item = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, $2, 'Item', 'صنف') RETURNING id`,
    [companyId, `IT-${randomUUID().slice(0, 8)}`],
  );
  const variant = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, $3) RETURNING id`,
    [companyId, item.rows[0].id, `SKU-${randomUUID().slice(0, 8)}`],
  );
  return variant.rows[0].id;
}

beforeAll(async () => {
  client = newClient();
  await client.connect();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co SQ', 'شركة') RETURNING id`,
    [`TEST_SQ_${randomUUID().slice(0, 8)}`],
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

  const customer = await client.query(
    `INSERT INTO customers (company_id, customer_code, name_en, name_ar) VALUES ($1, 'C1', 'Al Test Trading', 'عميل 1') RETURNING id`,
    [companyId],
  );
  customerId = customer.rows[0].id;

  const salesperson = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, 'x', 'Salesperson', 'بائع') RETURNING id`,
    [`sqsales_${randomUUID()}@test.local`],
  );
  salespersonId = salesperson.rows[0].id;
});

afterAll(async () => {
  await client.query(`SET app.bypass_immutability = 'true'`);
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_quotation_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_quotations WHERE company_id = $1`, [companyId]);
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

describe("sales quotation state machine", () => {
  it("walks draft -> sent -> accepted -> converted_to_invoice, posting a real wholesale invoice", async () => {
    const variantId = await newItemVariant();
    const quotationId = await createSalesQuotation(client, {
      companyId, storeId, customerId, salespersonId, quotationDate: "2026-03-10",
      lines: [{ itemVariantId: variantId, itemDescription: "Widget", qty: 10, unitPrice: 100, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
      createdBy: salespersonId,
    });

    let row = await client.query(`SELECT document_status, gross_amount FROM sales_quotations WHERE id = $1`, [quotationId]);
    expect(row.rows[0].document_status).toBe("draft");
    expect(Number(row.rows[0].gross_amount)).toBe(1150); // 10 * 100 * 1.15

    await sendSalesQuotation(client, quotationId);
    row = await client.query(`SELECT document_status, sent_at FROM sales_quotations WHERE id = $1`, [quotationId]);
    expect(row.rows[0].document_status).toBe("sent");
    expect(row.rows[0].sent_at).not.toBeNull();

    await acceptSalesQuotation(client, quotationId, salespersonId);
    row = await client.query(`SELECT document_status, decided_at, decided_by FROM sales_quotations WHERE id = $1`, [quotationId]);
    expect(row.rows[0].document_status).toBe("accepted");
    expect(row.rows[0].decided_at).not.toBeNull();
    expect(row.rows[0].decided_by).toBe(salespersonId);

    const invoiceId = await convertSalesQuotationToInvoice(client, {
      quotationId, companyId, storeId, customerId,
      invoiceDate: "2026-03-11", fiscalPeriodId: periodId,
      salespersonId, createdBy: salespersonId,
    });

    const invoice = await client.query(
      `SELECT invoice_channel, gross_amount, document_status FROM sales_invoices WHERE id = $1`,
      [invoiceId],
    );
    expect(invoice.rows[0].invoice_channel).toBe("wholesale");
    expect(Number(invoice.rows[0].gross_amount)).toBe(1150);
    expect(invoice.rows[0].document_status).toBe("posted"); // conversion also posts the invoice

    row = await client.query(`SELECT document_status, sales_invoice_id FROM sales_quotations WHERE id = $1`, [quotationId]);
    expect(row.rows[0].document_status).toBe("converted_to_invoice");
    expect(row.rows[0].sales_invoice_id).toBe(invoiceId);
  });

  it("requires a reason to reject, and locks the quotation afterward", async () => {
    const variantId = await newItemVariant();
    const quotationId = await createSalesQuotation(client, {
      companyId, storeId, customerId, salespersonId, quotationDate: "2026-03-12",
      lines: [{ itemVariantId: variantId, itemDescription: "Widget", qty: 5, unitPrice: 50, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
      createdBy: salespersonId,
    });
    await sendSalesQuotation(client, quotationId);

    await expect(rejectSalesQuotation(client, quotationId, salespersonId, "")).rejects.toThrow(/reason/);

    await rejectSalesQuotation(client, quotationId, salespersonId, "Customer found a cheaper supplier");
    const row = await client.query(`SELECT document_status, rejection_reason FROM sales_quotations WHERE id = $1`, [quotationId]);
    expect(row.rows[0].document_status).toBe("rejected");
    expect(row.rows[0].rejection_reason).toBe("Customer found a cheaper supplier");

    await expect(
      client.query(`UPDATE sales_quotations SET document_status = 'accepted', decided_by = $2 WHERE id = $1`, [quotationId, salespersonId]),
    ).rejects.toThrow(/is rejected and cannot be modified/);
  });

  it("rejects sending an empty quotation and locks lines once sent", async () => {
    const variantId = await newItemVariant();
    const emptyId = await createSalesQuotation(client, {
      companyId, storeId, customerId, quotationDate: "2026-03-13", lines: [], createdBy: salespersonId,
    });
    await expect(sendSalesQuotation(client, emptyId)).rejects.toThrow(/no lines/);

    const quotationId = await createSalesQuotation(client, {
      companyId, storeId, customerId, quotationDate: "2026-03-13",
      lines: [{ itemVariantId: variantId, itemDescription: "Widget", qty: 3, unitPrice: 40, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
      createdBy: salespersonId,
    });
    await sendSalesQuotation(client, quotationId);

    const line = await client.query(`SELECT id FROM sales_quotation_lines WHERE quotation_id = $1`, [quotationId]);
    await expect(
      client.query(`UPDATE sales_quotation_lines SET qty = 99 WHERE id = $1`, [line.rows[0].id]),
    ).rejects.toThrow(/immutable/);
  });

  it("lets the creator withdraw a sent quotation, and locks it afterward", async () => {
    const variantId = await newItemVariant();
    const quotationId = await createSalesQuotation(client, {
      companyId, storeId, customerId, quotationDate: "2026-03-15",
      lines: [{ itemVariantId: variantId, itemDescription: "Widget", qty: 2, unitPrice: 60, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
      createdBy: salespersonId,
    });
    await sendSalesQuotation(client, quotationId);

    await withdrawSalesQuotation(client, quotationId);
    const row = await client.query(`SELECT document_status FROM sales_quotations WHERE id = $1`, [quotationId]);
    expect(row.rows[0].document_status).toBe("withdrawn");

    await expect(acceptSalesQuotation(client, quotationId, salespersonId)).rejects.toThrow(/is withdrawn and cannot be modified/);
  });

  it("rejects an illegal status jump, e.g. draft straight to accepted", async () => {
    const variantId = await newItemVariant();
    const quotationId = await createSalesQuotation(client, {
      companyId, storeId, customerId, quotationDate: "2026-03-14",
      lines: [{ itemVariantId: variantId, itemDescription: "Widget", qty: 1, unitPrice: 10, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
      createdBy: salespersonId,
    });
    await expect(
      client.query(`UPDATE sales_quotations SET document_status = 'accepted', decided_by = $2 WHERE id = $1`, [quotationId, salespersonId]),
    ).rejects.toThrow(/illegal sales quotation status transition/);
  });
});
