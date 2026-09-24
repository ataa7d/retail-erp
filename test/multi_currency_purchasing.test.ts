import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { newClient } from "./helpers.js";
import {
  createPurchaseOrder,
  postPurchaseOrder,
  createGoodsReceipt,
  postGoodsReceipt,
  createSupplierInvoice,
  postSupplierInvoice,
} from "../src/purchasing/purchasingService.js";
import { createSupplierPayment, postSupplierPayment } from "../src/accounting/accountingService.js";
import { MissingExchangeRateError } from "../src/currency/exchangeRates.js";

let client: Client;
let companyId: string;
let storeId: string;
let usdSupplierId: string;
let periodId: string;
let userId: string;
const accountIds: Record<string, string> = {};

async function newItemVariant(): Promise<string> {
  const item = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, $2, 'Imported Item', 'صنف مستورد') RETURNING id`,
    [companyId, `IT-${randomUUID().slice(0, 8)}`],
  );
  const variant = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, $3) RETURNING id`,
    [companyId, item.rows[0].id, `SKU-${randomUUID().slice(0, 8)}`],
  );
  return variant.rows[0].id;
}

/** Signed (debit - credit) amount per account code for one journal. */
async function journalByAccount(journalId: string): Promise<Record<string, number>> {
  const r = await client.query(
    `SELECT coa.account_code, jl.debit_amount, jl.credit_amount
     FROM journal_lines jl JOIN chart_of_accounts coa ON coa.id = jl.account_id
     WHERE jl.journal_id = $1`,
    [journalId],
  );
  const out: Record<string, number> = {};
  for (const row of r.rows) {
    out[row.account_code] = Math.round(((out[row.account_code] ?? 0) + Number(row.debit_amount) - Number(row.credit_amount)) * 100) / 100;
  }
  return out;
}

async function journalBalances(journalId: string): Promise<boolean> {
  const r = await client.query(
    `SELECT SUM(debit_amount) AS d, SUM(credit_amount) AS c FROM journal_lines WHERE journal_id = $1`,
    [journalId],
  );
  return Number(r.rows[0].d) === Number(r.rows[0].c);
}

beforeAll(async () => {
  client = newClient();
  await client.connect();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar, base_currency) VALUES ($1, 'Test Co FX', 'شركة', 'SAR') RETURNING id`,
    [`TEST_FX_${randomUUID().slice(0, 8)}`],
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
    `INSERT INTO suppliers (company_id, supplier_code, name_en, name_ar, currency) VALUES ($1, 'SUP-USD', 'Overseas Supplier', 'مورد خارجي', 'USD') RETURNING id`,
    [companyId],
  );
  usdSupplierId = supplier.rows[0].id;

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
    ["1110", "asset", "debit", "1000"],
    ["1130", "asset", "debit", "1000"],
    ["1140", "asset", "debit", "1000"],
    ["2120", "liability", "credit", "2000"],
    ["2130", "liability", "credit", "2000"],
    ["2140", "liability", "credit", "2000"],
    ["5120", "expense", "debit", "5000"],
    ["5400", "expense", "debit", "5000"],
  ];
  for (const [code, type, bal, parent] of leaves) {
    const r = await client.query(
      `INSERT INTO chart_of_accounts (company_id, parent_id, account_code, name_en, name_ar, account_type, normal_balance)
       VALUES ($1, $2, $3, $3, $3, $4, $5) RETURNING id`,
      [companyId, groupIds[parent], code, type, bal],
    );
    accountIds[code] = r.rows[0].id;
  }

  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, 'x', 'FX User', 'مستخدم') RETURNING id`,
    [`fxuser_${randomUUID()}@test.local`],
  );
  userId = user.rows[0].id;

  // The dollar moves during the month: 3.75 at order/receipt, 3.80 by the
  // invoice, 3.70 by the first payment.
  for (const [date, rate] of [["2026-03-01", 3.75], ["2026-03-10", 3.8], ["2026-03-20", 3.7]] as const) {
    await client.query(`INSERT INTO exchange_rates (company_id, currency, rate_date, rate) VALUES ($1, 'USD', $2, $3)`, [companyId, date, rate]);
  }
});

afterAll(async () => {
  await client.query(`SET app.bypass_immutability = 'true'`);
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM supplier_payment_allocations WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM supplier_payments WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM supplier_invoice_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM supplier_invoices WHERE company_id = $1`, [companyId]);
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
  await client.query(`DELETE FROM exchange_rates WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM suppliers WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM chart_of_accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("USD import: PO -> receipt -> invoice -> two payments, rate moving throughout", () => {
  let poId: string;
  let receiptId: string;
  let invoiceId: string;
  let variantId: string;

  it("PO carries USD and the rate on file for its date; the supplier cost catalog stays in USD", async () => {
    variantId = await newItemVariant();
    poId = await createPurchaseOrder(client, {
      companyId, storeId, supplierId: usdSupplierId, orderDate: "2026-03-01", fiscalPeriodId: periodId, createdBy: userId,
      currency: "USD",
      // Imports carry no KSA VAT from the overseas supplier (import VAT is settled with customs).
      lines: [{ itemVariantId: variantId, qty: 100, unitPrice: 10, discountAmount: 0, vatRate: 0, priceIncludesVat: false }],
    });
    await postPurchaseOrder(client, poId, userId);

    const po = await client.query(`SELECT currency, exchange_rate, gross_amount FROM purchase_orders WHERE id = $1`, [poId]);
    expect(po.rows[0].currency).toBe("USD");
    expect(Number(po.rows[0].exchange_rate)).toBe(3.75);
    expect(Number(po.rows[0].gross_amount)).toBe(1000); // USD, not SAR

    const price = await client.query(
      `SELECT unit_cost, currency FROM supplier_item_prices WHERE supplier_id = $1 AND item_variant_id = $2`,
      [usdSupplierId, variantId],
    );
    expect(Number(price.rows[0].unit_cost)).toBe(10);
    expect(price.rows[0].currency).toBe("USD");
  });

  it("goods receipt values inventory and GRNI in SAR at the receipt-date rate, with SAR landed cost on top", async () => {
    const poLine = await client.query(`SELECT id FROM purchase_order_lines WHERE purchase_order_id = $1`, [poId]);
    receiptId = await createGoodsReceipt(client, {
      companyId, storeId, purchaseOrderId: poId, supplierId: usdSupplierId, receiptDate: "2026-03-05", fiscalPeriodId: periodId, createdBy: userId,
      lines: [{ purchaseOrderLineId: poLine.rows[0].id, itemVariantId: variantId, qtyReceived: 100 }],
      charges: [{ chargeType: "customs", amount: 150 }], // paid locally, in SAR
    });
    await postGoodsReceipt(client, receiptId, userId);

    const gr = await client.query(`SELECT currency, exchange_rate, journal_id FROM goods_receipts WHERE id = $1`, [receiptId]);
    expect(gr.rows[0].currency).toBe("USD");
    expect(Number(gr.rows[0].exchange_rate)).toBe(3.75);

    const grLine = await client.query(`SELECT base_unit_cost, base_currency_unit_cost, unit_cost FROM goods_receipt_lines WHERE goods_receipt_id = $1`, [receiptId]);
    expect(Number(grLine.rows[0].base_unit_cost)).toBe(10); // USD, for price matching
    expect(Number(grLine.rows[0].base_currency_unit_cost)).toBe(37.5); // 10 * 3.75
    expect(Number(grLine.rows[0].unit_cost)).toBe(39); // 37.50 + 150/100 landed

    const balance = await client.query(`SELECT avg_unit_cost FROM stock_balances WHERE store_id = $1 AND item_variant_id = $2`, [storeId, variantId]);
    expect(Number(balance.rows[0].avg_unit_cost)).toBe(39);

    const byAccount = await journalByAccount(gr.rows[0].journal_id);
    expect(byAccount["1130"]).toBe(3900); // Dr Inventory: 3,750 merchandise + 150 customs
    expect(byAccount["2120"]).toBe(-3750); // Cr GRNI at 3.75
    expect(byAccount["2140"]).toBe(-150); // Cr landed cost accrual
  });

  it("supplier invoice books AP at the invoice-date rate, splitting price variance from FX", async () => {
    const grLine = await client.query(`SELECT id FROM goods_receipt_lines WHERE goods_receipt_id = $1`, [receiptId]);
    invoiceId = await createSupplierInvoice(client, {
      companyId, supplierId: usdSupplierId, purchaseOrderId: poId, supplierInvoiceNumber: "GZ-2026-118",
      invoiceDate: "2026-03-12", fiscalPeriodId: periodId, createdBy: userId,
      // supplier bills 10.20 vs the 10.00 PO price (2%, inside the 5% tolerance)
      lines: [{ goodsReceiptLineId: grLine.rows[0].id, itemVariantId: variantId, qty: 100, unitPrice: 10.2, discountAmount: 0, vatRate: 0, priceIncludesVat: false }],
    });
    await postSupplierInvoice(client, invoiceId, userId);

    const inv = await client.query(
      `SELECT currency, exchange_rate, gross_amount, base_gross_amount, journal_id FROM supplier_invoices WHERE id = $1`,
      [invoiceId],
    );
    expect(Number(inv.rows[0].exchange_rate)).toBe(3.8); // latest rate on or before 03-12
    expect(Number(inv.rows[0].gross_amount)).toBe(1020); // USD owed
    expect(Number(inv.rows[0].base_gross_amount)).toBe(3876); // 1,020 * 3.80

    expect(await journalBalances(inv.rows[0].journal_id)).toBe(true);
    const byAccount = await journalByAccount(inv.rows[0].journal_id);
    expect(byAccount["2120"]).toBe(3750); // GRNI cleared at exactly what was accrued
    expect(byAccount["5120"]).toBe(76); // price variance: USD 20 * 3.80
    expect(byAccount["5400"]).toBe(50); // FX loss: USD 1,000 * (3.80 - 3.75)
    expect(byAccount["2130"]).toBe(-3876); // Cr AP

    // GRNI for this receipt nets to zero across receipt + invoice.
    const grni = await client.query(
      `SELECT SUM(jl.debit_amount - jl.credit_amount) AS net FROM journal_lines jl
       WHERE jl.account_id = $1`,
      [accountIds["2120"]],
    );
    expect(Number(grni.rows[0].net)).toBe(0);
  });

  it("first partial payment at a lower rate books a realized FX gain and leaves USD open in AP", async () => {
    const paymentId = await createSupplierPayment(client, {
      companyId, supplierId: usdSupplierId, paymentDate: "2026-03-22", fiscalPeriodId: periodId, paymentMethod: "cash",
      amount: 500, currency: "USD", createdBy: userId,
      allocations: [{ supplierInvoiceId: invoiceId, allocatedAmount: 500 }],
    });
    await postSupplierPayment(client, paymentId, userId);

    const pay = await client.query(`SELECT exchange_rate, base_amount, journal_id FROM supplier_payments WHERE id = $1`, [paymentId]);
    expect(Number(pay.rows[0].exchange_rate)).toBe(3.7);
    expect(Number(pay.rows[0].base_amount)).toBe(1850); // 500 * 3.70 actually left the bank

    const byAccount = await journalByAccount(pay.rows[0].journal_id);
    expect(byAccount["2130"]).toBe(1900); // AP relieved at the invoice's 3.80
    expect(byAccount["1110"]).toBe(-1850);
    expect(byAccount["5400"]).toBe(-50); // FX gain

    const open = await client.query(`SELECT ap_original_amount - allocated_amount AS open, currency FROM ap_open_items WHERE supplier_invoice_id = $1`, [invoiceId]);
    expect(Number(open.rows[0].open)).toBe(520);
    expect(open.rows[0].currency).toBe("USD");
  });

  it("final payment at an explicit bank rate settles the rest; AP for the invoice nets to exactly zero in SAR", async () => {
    const paymentId = await createSupplierPayment(client, {
      companyId, supplierId: usdSupplierId, paymentDate: "2026-03-25", fiscalPeriodId: periodId, paymentMethod: "cash",
      amount: 520, currency: "USD", exchangeRate: 3.85, createdBy: userId,
      allocations: [{ supplierInvoiceId: invoiceId, allocatedAmount: 520 }],
    });
    await postSupplierPayment(client, paymentId, userId);

    const pay = await client.query(`SELECT journal_id FROM supplier_payments WHERE id = $1`, [paymentId]);
    const byAccount = await journalByAccount(pay.rows[0].journal_id);
    expect(byAccount["2130"]).toBe(1976); // 520 * 3.80
    expect(byAccount["1110"]).toBe(-2002); // 520 * 3.85
    expect(byAccount["5400"]).toBe(26); // FX loss

    const ap = await client.query(`SELECT SUM(debit_amount - credit_amount) AS net FROM journal_lines WHERE account_id = $1`, [accountIds["2130"]]);
    expect(Number(ap.rows[0].net)).toBe(0);

    // Net FX over the whole cycle: 50 loss (invoice) - 50 gain + 26 loss (payments).
    const fx = await client.query(`SELECT SUM(debit_amount - credit_amount) AS net FROM journal_lines WHERE account_id = $1`, [accountIds["5400"]]);
    expect(Number(fx.rows[0].net)).toBe(26);
  });
});

describe("guard rails", () => {
  it("refuses a foreign-currency document when no rate is on file and none is given", async () => {
    const variantId = await newItemVariant();
    await expect(
      createPurchaseOrder(client, {
        companyId, storeId, supplierId: usdSupplierId, orderDate: "2026-03-01", fiscalPeriodId: periodId, createdBy: userId,
        currency: "EUR",
        lines: [{ itemVariantId: variantId, qty: 1, unitPrice: 10, discountAmount: 0, vatRate: 0, priceIncludesVat: false }],
      }),
    ).rejects.toBeInstanceOf(MissingExchangeRateError);
  });

  it("rejects a base-currency document carrying a rate other than 1", async () => {
    await expect(
      client.query(
        `INSERT INTO purchase_orders (company_id, store_id, supplier_id, document_number, order_date, fiscal_period_id, currency, exchange_rate)
         VALUES ($1, $2, $3, 'PO-BAD', '2026-03-01', $4, 'SAR', 3.75)`,
        [companyId, storeId, usdSupplierId, periodId],
      ),
    ).rejects.toThrow(/base currency/);
  });

  it("rejects settling a USD invoice with a SAR payment", async () => {
    const invoice = await client.query(`SELECT id FROM supplier_invoices WHERE company_id = $1 AND currency = 'USD' LIMIT 1`, [companyId]);
    await expect(
      createSupplierPayment(client, {
        companyId, supplierId: usdSupplierId, paymentDate: "2026-03-25", fiscalPeriodId: periodId, paymentMethod: "cash",
        amount: 10, currency: "SAR", createdBy: userId,
        allocations: [{ supplierInvoiceId: invoice.rows[0].id, allocatedAmount: 10 }],
      }),
    ).rejects.toThrow(/cannot settle invoice in USD/);
  });
});
