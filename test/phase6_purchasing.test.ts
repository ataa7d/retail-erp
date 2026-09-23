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
  createSupplierCreditNote,
  postSupplierCreditNote,
} from "../src/purchasing/purchasingService.js";

let client: Client;
let companyId: string;
let storeId: string;
let supplierId: string;
let periodId: string;
let userId: string;

async function newItemVariant(weightKg?: number): Promise<string> {
  const item = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar, weight_kg) VALUES ($1, $2, 'Item', 'صنف', $3) RETURNING id`,
    [companyId, `IT-${randomUUID().slice(0, 8)}`, weightKg ?? null],
  );
  const variant = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, $3) RETURNING id`,
    [companyId, item.rows[0].id, `SKU-${randomUUID().slice(0, 8)}`],
  );
  return variant.rows[0].id;
}

async function balance(itemVariantId: string) {
  const r = await client.query(
    `SELECT qty_on_hand, avg_unit_cost FROM stock_balances WHERE store_id = $1 AND item_variant_id = $2`,
    [storeId, itemVariantId],
  );
  return r.rows[0] ? { qty: Number(r.rows[0].qty_on_hand), avgCost: Number(r.rows[0].avg_unit_cost) } : { qty: 0, avgCost: 0 };
}

async function journalTotals(journalId: string) {
  const r = await client.query(`SELECT debit_amount, credit_amount FROM journal_lines WHERE journal_id = $1`, [journalId]);
  const debit = r.rows.reduce((s, row) => s + Number(row.debit_amount), 0);
  const credit = r.rows.reduce((s, row) => s + Number(row.credit_amount), 0);
  return { debit: round2(debit), credit: round2(credit) };
}
function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

beforeAll(async () => {
  client = newClient();
  await client.connect();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co P6', 'شركة') RETURNING id`,
    [`TEST_P6_${randomUUID().slice(0, 8)}`],
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

  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, 'x', 'Test User', 'مستخدم') RETURNING id`,
    [`p6user_${randomUUID()}@test.local`],
  );
  userId = user.rows[0].id;
});

afterAll(async () => {
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
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("PO -> goods receipt -> supplier invoice, exact match", () => {
  it("accrues GRNI at receipt, clears it and credits AP at invoice, with a balanced journal each time", async () => {
    const variantId = await newItemVariant();

    const poId = await createPurchaseOrder(client, {
      companyId, storeId, supplierId, orderDate: "2026-03-01", fiscalPeriodId: periodId, createdBy: userId,
      lines: [{ itemVariantId: variantId, qty: 100, unitPrice: 10, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await postPurchaseOrder(client, poId, userId);

    const poLine = await client.query(`SELECT id FROM purchase_order_lines WHERE purchase_order_id = $1`, [poId]);
    const poLineId = poLine.rows[0].id;

    const receiptId = await createGoodsReceipt(client, {
      companyId, storeId, purchaseOrderId: poId, supplierId, receiptDate: "2026-03-05", fiscalPeriodId: periodId, createdBy: userId,
      lines: [{ purchaseOrderLineId: poLineId, itemVariantId: variantId, qtyReceived: 100 }],
    });
    await postGoodsReceipt(client, receiptId, userId);

    expect((await balance(variantId)).qty).toBe(100);
    expect((await balance(variantId)).avgCost).toBe(10);

    const receipt = await client.query(`SELECT journal_id FROM goods_receipts WHERE id = $1`, [receiptId]);
    const grTotals = await journalTotals(receipt.rows[0].journal_id);
    expect(grTotals.debit).toBe(1000); // 100 * 10, Dr Inventory
    expect(grTotals.credit).toBe(1000); // Cr GRNI (no landed cost)

    const grLine = await client.query(`SELECT id FROM goods_receipt_lines WHERE goods_receipt_id = $1`, [receiptId]);

    const invoiceId = await createSupplierInvoice(client, {
      companyId, supplierId, purchaseOrderId: poId, supplierInvoiceNumber: "SUP-INV-001",
      invoiceDate: "2026-03-08", fiscalPeriodId: periodId, createdBy: userId,
      lines: [{ goodsReceiptLineId: grLine.rows[0].id, itemVariantId: variantId, qty: 100, unitPrice: 10, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await postSupplierInvoice(client, invoiceId, userId);

    const invoice = await client.query(`SELECT journal_id, gross_amount FROM supplier_invoices WHERE id = $1`, [invoiceId]);
    const invTotals = await journalTotals(invoice.rows[0].journal_id);
    expect(invTotals.debit).toBe(invTotals.credit);
    expect(invTotals.credit).toBe(Number(invoice.rows[0].gross_amount)); // 1150.00, all to AP (no variance)
  });
});

describe("three-way match tolerances", () => {
  it("rejects a goods receipt that over-receives beyond the ordered qty", async () => {
    const variantId = await newItemVariant();
    const poId = await createPurchaseOrder(client, {
      companyId, storeId, supplierId, orderDate: "2026-03-01", fiscalPeriodId: periodId, createdBy: userId,
      lines: [{ itemVariantId: variantId, qty: 10, unitPrice: 5, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await postPurchaseOrder(client, poId, userId);
    const poLine = await client.query(`SELECT id FROM purchase_order_lines WHERE purchase_order_id = $1`, [poId]);

    await expect(
      createGoodsReceipt(client, {
        companyId, storeId, purchaseOrderId: poId, supplierId, receiptDate: "2026-03-05", fiscalPeriodId: periodId, createdBy: userId,
        lines: [{ purchaseOrderLineId: poLine.rows[0].id, itemVariantId: variantId, qtyReceived: 15 }], // company default tolerance is 0%
      }),
    ).rejects.toThrow(/exceed the tolerated quantity/);
  });

  it("rejects a supplier invoice whose price exceeds the configured tolerance", async () => {
    const variantId = await newItemVariant();
    const poId = await createPurchaseOrder(client, {
      companyId, storeId, supplierId, orderDate: "2026-03-01", fiscalPeriodId: periodId, createdBy: userId,
      lines: [{ itemVariantId: variantId, qty: 10, unitPrice: 5, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await postPurchaseOrder(client, poId, userId);
    const poLine = await client.query(`SELECT id FROM purchase_order_lines WHERE purchase_order_id = $1`, [poId]);
    const receiptId = await createGoodsReceipt(client, {
      companyId, storeId, purchaseOrderId: poId, supplierId, receiptDate: "2026-03-05", fiscalPeriodId: periodId, createdBy: userId,
      lines: [{ purchaseOrderLineId: poLine.rows[0].id, itemVariantId: variantId, qtyReceived: 10 }],
    });
    await postGoodsReceipt(client, receiptId, userId);
    const grLine = await client.query(`SELECT id FROM goods_receipt_lines WHERE goods_receipt_id = $1`, [receiptId]);

    // Company default price tolerance is 5%; invoice at 6.00 vs GR base 5.00 is 20% off.
    const invoiceId = await createSupplierInvoice(client, {
      companyId, supplierId, purchaseOrderId: poId, supplierInvoiceNumber: "SUP-INV-BAD",
      invoiceDate: "2026-03-08", fiscalPeriodId: periodId, createdBy: userId,
      lines: [{ goodsReceiptLineId: grLine.rows[0].id, itemVariantId: variantId, qty: 10, unitPrice: 6, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });

    await expect(postSupplierInvoice(client, invoiceId, userId)).rejects.toThrow(/differs from received cost/);
  });
});

describe("price variance within tolerance is booked, not rejected", () => {
  it("posts the difference to Purchase Price Variance and still balances", async () => {
    const variantId = await newItemVariant();
    const poId = await createPurchaseOrder(client, {
      companyId, storeId, supplierId, orderDate: "2026-03-01", fiscalPeriodId: periodId, createdBy: userId,
      lines: [{ itemVariantId: variantId, qty: 10, unitPrice: 100, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await postPurchaseOrder(client, poId, userId);
    const poLine = await client.query(`SELECT id FROM purchase_order_lines WHERE purchase_order_id = $1`, [poId]);
    const receiptId = await createGoodsReceipt(client, {
      companyId, storeId, purchaseOrderId: poId, supplierId, receiptDate: "2026-03-05", fiscalPeriodId: periodId, createdBy: userId,
      lines: [{ purchaseOrderLineId: poLine.rows[0].id, itemVariantId: variantId, qtyReceived: 10 }],
    });
    await postGoodsReceipt(client, receiptId, userId);
    const grLine = await client.query(`SELECT id FROM goods_receipt_lines WHERE goods_receipt_id = $1`, [receiptId]);

    // 103 vs base 100 = 3% variance, within the 5% default tolerance.
    const invoiceId = await createSupplierInvoice(client, {
      companyId, supplierId, purchaseOrderId: poId, supplierInvoiceNumber: "SUP-INV-VAR",
      invoiceDate: "2026-03-08", fiscalPeriodId: periodId, createdBy: userId,
      lines: [{ goodsReceiptLineId: grLine.rows[0].id, itemVariantId: variantId, qty: 10, unitPrice: 103, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await postSupplierInvoice(client, invoiceId, userId);

    const invoice = await client.query(`SELECT journal_id FROM supplier_invoices WHERE id = $1`, [invoiceId]);
    const totals = await journalTotals(invoice.rows[0].journal_id);
    expect(totals.debit).toBe(totals.credit);

    const variance = await client.query(
      `SELECT jl.debit_amount FROM journal_lines jl JOIN chart_of_accounts coa ON coa.id = jl.account_id
       WHERE jl.journal_id = $1 AND coa.account_code = '5120'`,
      [invoice.rows[0].journal_id],
    );
    expect(Number(variance.rows[0].debit_amount)).toBe(30); // 10 units * (103-100)
  });
});

describe("landed cost allocation", () => {
  it("allocates freight by value across receipt lines and updates unit cost", async () => {
    const cheapVariant = await newItemVariant();
    const expensiveVariant = await newItemVariant();

    const poId = await createPurchaseOrder(client, {
      companyId, storeId, supplierId, orderDate: "2026-03-01", fiscalPeriodId: periodId, createdBy: userId,
      lines: [
        { itemVariantId: cheapVariant, qty: 10, unitPrice: 10, discountAmount: 0, vatRate: 15, priceIncludesVat: false },   // value 100
        { itemVariantId: expensiveVariant, qty: 10, unitPrice: 90, discountAmount: 0, vatRate: 15, priceIncludesVat: false }, // value 900
      ],
    });
    await postPurchaseOrder(client, poId, userId);
    const poLines = await client.query(`SELECT id, item_variant_id FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY line_number`, [poId]);

    const receiptId = await createGoodsReceipt(client, {
      companyId, storeId, purchaseOrderId: poId, supplierId, receiptDate: "2026-03-05", fiscalPeriodId: periodId, createdBy: userId,
      lines: poLines.rows.map((l) => ({ purchaseOrderLineId: l.id, itemVariantId: l.item_variant_id, qtyReceived: 10 })),
      charges: [{ chargeType: "freight", amount: 100, allocationBasis: "value" }], // total receipt value 1000, so 10% of value each
    });
    await postGoodsReceipt(client, receiptId, userId);

    // cheap line: value 100/1000 = 10% of freight = 10.00 landed cost / 10 units = 1.00/unit -> unit_cost 11.00
    // expensive line: value 900/1000 = 90% of freight = 90.00 / 10 units = 9.00/unit -> unit_cost 99.00
    expect((await balance(cheapVariant)).avgCost).toBe(11);
    expect((await balance(expensiveVariant)).avgCost).toBe(99);

    const receipt = await client.query(`SELECT journal_id FROM goods_receipts WHERE id = $1`, [receiptId]);
    const totals = await journalTotals(receipt.rows[0].journal_id);
    expect(totals.debit).toBe(totals.credit);
    expect(totals.debit).toBe(1100); // 1000 merchandise + 100 freight, capitalized into inventory

    const landedAccrual = await client.query(
      `SELECT jl.credit_amount FROM journal_lines jl JOIN chart_of_accounts coa ON coa.id = jl.account_id
       WHERE jl.journal_id = $1 AND coa.account_code = '2140'`,
      [receipt.rows[0].journal_id],
    );
    expect(Number(landedAccrual.rows[0].credit_amount)).toBe(100);
  });

  it("allocates by weight when requested", async () => {
    const lightVariant = await newItemVariant(1); // 1kg each
    const heavyVariant = await newItemVariant(9); // 9kg each

    const poId = await createPurchaseOrder(client, {
      companyId, storeId, supplierId, orderDate: "2026-03-01", fiscalPeriodId: periodId, createdBy: userId,
      lines: [
        { itemVariantId: lightVariant, qty: 10, unitPrice: 50, discountAmount: 0, vatRate: 15, priceIncludesVat: false },
        { itemVariantId: heavyVariant, qty: 10, unitPrice: 50, discountAmount: 0, vatRate: 15, priceIncludesVat: false },
      ],
    });
    await postPurchaseOrder(client, poId, userId);
    const poLines = await client.query(`SELECT id, item_variant_id FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY line_number`, [poId]);

    const receiptId = await createGoodsReceipt(client, {
      companyId, storeId, purchaseOrderId: poId, supplierId, receiptDate: "2026-03-05", fiscalPeriodId: periodId, createdBy: userId,
      lines: poLines.rows.map((l) => ({ purchaseOrderLineId: l.id, itemVariantId: l.item_variant_id, qtyReceived: 10 })),
      charges: [{ chargeType: "freight", amount: 100, allocationBasis: "weight" }], // total weight 100kg: light=10kg (10%), heavy=90kg (90%)
    });
    await postGoodsReceipt(client, receiptId, userId);

    expect((await balance(lightVariant)).avgCost).toBe(51); // 50 + (10 landed / 10 units)
    expect((await balance(heavyVariant)).avgCost).toBe(59); // 50 + (90 landed / 10 units)
  });
});

describe("supplier credit note (purchase return)", () => {
  it("reduces AP and inventory, and books any variance against current average cost", async () => {
    const variantId = await newItemVariant();
    const poId = await createPurchaseOrder(client, {
      companyId, storeId, supplierId, orderDate: "2026-03-01", fiscalPeriodId: periodId, createdBy: userId,
      lines: [{ itemVariantId: variantId, qty: 20, unitPrice: 10, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await postPurchaseOrder(client, poId, userId);
    const poLine = await client.query(`SELECT id FROM purchase_order_lines WHERE purchase_order_id = $1`, [poId]);
    const receiptId = await createGoodsReceipt(client, {
      companyId, storeId, purchaseOrderId: poId, supplierId, receiptDate: "2026-03-05", fiscalPeriodId: periodId, createdBy: userId,
      lines: [{ purchaseOrderLineId: poLine.rows[0].id, itemVariantId: variantId, qtyReceived: 20 }],
    });
    await postGoodsReceipt(client, receiptId, userId);
    const grLine = await client.query(`SELECT id FROM goods_receipt_lines WHERE goods_receipt_id = $1`, [receiptId]);

    const invoiceId = await createSupplierInvoice(client, {
      companyId, supplierId, purchaseOrderId: poId, supplierInvoiceNumber: "SUP-INV-RET",
      invoiceDate: "2026-03-08", fiscalPeriodId: periodId, createdBy: userId,
      lines: [{ goodsReceiptLineId: grLine.rows[0].id, itemVariantId: variantId, qty: 20, unitPrice: 10, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await postSupplierInvoice(client, invoiceId, userId);
    expect((await balance(variantId)).qty).toBe(20);

    const invoiceLine = await client.query(`SELECT id FROM supplier_invoice_lines WHERE supplier_invoice_id = $1`, [invoiceId]);

    const creditNoteId = await createSupplierCreditNote(client, {
      companyId, storeId, supplierId, originalInvoiceId: invoiceId,
      creditNoteDate: "2026-03-10", fiscalPeriodId: periodId, reason: "damaged goods", createdBy: userId,
      lines: [{ sourceLineId: invoiceLine.rows[0].id, itemVariantId: variantId, qty: 5, unitPrice: 10, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await postSupplierCreditNote(client, creditNoteId, userId);

    expect((await balance(variantId)).qty).toBe(15); // 20 - 5

    const cn = await client.query(`SELECT journal_id, gross_amount FROM supplier_credit_notes WHERE id = $1`, [creditNoteId]);
    const totals = await journalTotals(cn.rows[0].journal_id);
    expect(totals.debit).toBe(totals.credit);
    expect(totals.debit).toBe(Number(cn.rows[0].gross_amount)); // Dr AP = gross (the only debit line here)
  });

  it("rejects returning more than was invoiced", async () => {
    const variantId = await newItemVariant();
    const poId = await createPurchaseOrder(client, {
      companyId, storeId, supplierId, orderDate: "2026-03-01", fiscalPeriodId: periodId, createdBy: userId,
      lines: [{ itemVariantId: variantId, qty: 5, unitPrice: 10, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await postPurchaseOrder(client, poId, userId);
    const poLine = await client.query(`SELECT id FROM purchase_order_lines WHERE purchase_order_id = $1`, [poId]);
    const receiptId = await createGoodsReceipt(client, {
      companyId, storeId, purchaseOrderId: poId, supplierId, receiptDate: "2026-03-05", fiscalPeriodId: periodId, createdBy: userId,
      lines: [{ purchaseOrderLineId: poLine.rows[0].id, itemVariantId: variantId, qtyReceived: 5 }],
    });
    await postGoodsReceipt(client, receiptId, userId);
    const grLine = await client.query(`SELECT id FROM goods_receipt_lines WHERE goods_receipt_id = $1`, [receiptId]);

    const invoiceId = await createSupplierInvoice(client, {
      companyId, supplierId, purchaseOrderId: poId, supplierInvoiceNumber: "SUP-INV-SMALL",
      invoiceDate: "2026-03-08", fiscalPeriodId: periodId, createdBy: userId,
      lines: [{ goodsReceiptLineId: grLine.rows[0].id, itemVariantId: variantId, qty: 5, unitPrice: 10, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });
    await postSupplierInvoice(client, invoiceId, userId);
    const invoiceLine = await client.query(`SELECT id FROM supplier_invoice_lines WHERE supplier_invoice_id = $1`, [invoiceId]);

    const creditNoteId = await createSupplierCreditNote(client, {
      companyId, storeId, supplierId, originalInvoiceId: invoiceId,
      creditNoteDate: "2026-03-10", fiscalPeriodId: periodId, reason: "too many", createdBy: userId,
      lines: [{ sourceLineId: invoiceLine.rows[0].id, itemVariantId: variantId, qty: 6, unitPrice: 10, discountAmount: 0, vatRate: 15, priceIncludesVat: false }],
    });

    await expect(postSupplierCreditNote(client, creditNoteId, userId)).rejects.toThrow(/exceed invoiced quantity/);
  });
});
