import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { newClient } from "./helpers.js";
import {
  createStocktake,
  postStocktake,
  recordStockMovement,
  recordStocktakeCount,
  transferStock,
} from "../src/inventory/inventoryService.js";
import { createSalesInvoice, postSalesInvoice, createCreditNote, postCreditNote } from "../src/sales/salesService.js";

let client: Client;
let companyId: string;
let storeAId: string;
let storeBId: string;
let periodId: string;
let userId: string;

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

async function balance(storeId: string, itemVariantId: string) {
  const r = await client.query(
    `SELECT qty_on_hand, avg_unit_cost, total_value FROM stock_balances WHERE store_id = $1 AND item_variant_id = $2`,
    [storeId, itemVariantId],
  );
  return r.rows[0]
    ? { qty: Number(r.rows[0].qty_on_hand), avgCost: Number(r.rows[0].avg_unit_cost), value: Number(r.rows[0].total_value) }
    : { qty: 0, avgCost: 0, value: 0 };
}

beforeAll(async () => {
  client = newClient();
  await client.connect();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co P5', 'شركة') RETURNING id`,
    [`TEST_P5_${randomUUID().slice(0, 8)}`],
  );
  companyId = company.rows[0].id;

  const branch = await client.query(
    `INSERT INTO branches (company_id, branch_code, name_en, name_ar) VALUES ($1, 'HQ', 'HQ', 'المقر') RETURNING id`,
    [companyId],
  );
  const storeA = await client.query(
    `INSERT INTO stores (company_id, branch_id, store_code, name_en, name_ar) VALUES ($1, $2, 'SA', 'Store A', 'متجر أ') RETURNING id`,
    [companyId, branch.rows[0].id],
  );
  storeAId = storeA.rows[0].id;
  const storeB = await client.query(
    `INSERT INTO stores (company_id, branch_id, store_code, name_en, name_ar) VALUES ($1, $2, 'SB', 'Store B', 'متجر ب') RETURNING id`,
    [companyId, branch.rows[0].id],
  );
  storeBId = storeB.rows[0].id;

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
    ["2110", "liability", "credit", "2000"],
    ["4110", "revenue", "credit", "4000"],
    ["4120", "revenue", "debit", "4000"],
    ["5100", "expense", "debit", "5000"],
    ["5110", "expense", "debit", "5000"],
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
    [`p5user_${randomUUID()}@test.local`],
  );
  userId = user.rows[0].id;
});

afterAll(async () => {
  await client.query(`SET app.bypass_immutability = 'true'`);
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stocktake_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stocktakes WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM credit_note_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM credit_notes WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoice_payments WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoice_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM sales_invoices WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journal_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journals WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_movements WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_balances WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_variants WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM items WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM chart_of_accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("weighted-average costing", () => {
  it("recalculates the average on each receipt and leaves it unchanged on issues", async () => {
    const variantId = await newItemVariant();

    await recordStockMovement(client, {
      companyId, storeId: storeAId, itemVariantId: variantId, movementType: "receipt",
      qty: 10, explicitUnitCost: 10, sourceType: "test_receipt", createdBy: userId,
    });
    expect((await balance(storeAId, variantId)).avgCost).toBe(10);

    // Receive 10 more at 20 -> new average = (10*10 + 10*20)/20 = 15
    await recordStockMovement(client, {
      companyId, storeId: storeAId, itemVariantId: variantId, movementType: "receipt",
      qty: 10, explicitUnitCost: 20, sourceType: "test_receipt", createdBy: userId,
    });
    expect((await balance(storeAId, variantId)).avgCost).toBe(15);
    expect((await balance(storeAId, variantId)).qty).toBe(20);

    // Issue 5 -> average unchanged at 15, even though caller passes no cost
    const issue = await recordStockMovement(client, {
      companyId, storeId: storeAId, itemVariantId: variantId, movementType: "issue",
      qty: -5, sourceType: "test_issue", createdBy: userId,
    });
    expect(issue.unitCost).toBe(15);
    expect((await balance(storeAId, variantId)).avgCost).toBe(15);
    expect((await balance(storeAId, variantId)).qty).toBe(15);
  });

  it("keeps a historical movement's cost fixed even after the average later changes", async () => {
    const variantId = await newItemVariant();

    await recordStockMovement(client, {
      companyId, storeId: storeAId, itemVariantId: variantId, movementType: "receipt",
      qty: 5, explicitUnitCost: 8, sourceType: "test_receipt", createdBy: userId,
    });
    const firstIssue = await recordStockMovement(client, {
      companyId, storeId: storeAId, itemVariantId: variantId, movementType: "issue",
      qty: -2, sourceType: "test_issue", createdBy: userId,
    });
    expect(firstIssue.unitCost).toBe(8);

    // A much more expensive receipt changes the average going forward...
    await recordStockMovement(client, {
      companyId, storeId: storeAId, itemVariantId: variantId, movementType: "receipt",
      qty: 5, explicitUnitCost: 100, sourceType: "test_receipt", createdBy: userId,
    });

    // ...but re-reading the FIRST issue from the ledger still shows its
    // original cost, never re-derived from the item's current average.
    const stored = await client.query(`SELECT unit_cost FROM stock_movements WHERE id = $1`, [firstIssue.id]);
    expect(Number(stored.rows[0].unit_cost)).toBe(8);
  });
});

describe("stock equals the sum of movements, always", () => {
  it("agrees with a full ledger rebuild after a mix of movements", async () => {
    const variantId = await newItemVariant();

    await recordStockMovement(client, { companyId, storeId: storeAId, itemVariantId: variantId, movementType: "receipt", qty: 20, explicitUnitCost: 12, sourceType: "test", createdBy: userId });
    await recordStockMovement(client, { companyId, storeId: storeAId, itemVariantId: variantId, movementType: "issue", qty: -7, sourceType: "test", createdBy: userId });
    await recordStockMovement(client, { companyId, storeId: storeAId, itemVariantId: variantId, movementType: "receipt", qty: 10, explicitUnitCost: 18, sourceType: "test", createdBy: userId });
    await recordStockMovement(client, { companyId, storeId: storeAId, itemVariantId: variantId, movementType: "adjustment_out", qty: -3, reasonCode: "damaged", sourceType: "adjustment", createdBy: userId });

    const liveBalance = await balance(storeAId, variantId);

    const sumResult = await client.query(
      `SELECT COALESCE(SUM(qty), 0) AS qty FROM stock_movements WHERE store_id = $1 AND item_variant_id = $2`,
      [storeAId, variantId],
    );
    expect(liveBalance.qty).toBe(Number(sumResult.rows[0].qty));

    await client.query(`SELECT fn_rebuild_stock_balance($1, $2)`, [storeAId, variantId]);
    const rebuiltBalance = await balance(storeAId, variantId);

    expect(rebuiltBalance.qty).toBe(liveBalance.qty);
    expect(rebuiltBalance.avgCost).toBe(liveBalance.avgCost);
    expect(rebuiltBalance.value).toBe(liveBalance.value);
  });
});

describe("adjustments require a reason code", () => {
  it("rejects an adjustment with no reason_code", async () => {
    const variantId = await newItemVariant();
    await expect(
      client.query(
        `INSERT INTO stock_movements (company_id, store_id, item_variant_id, movement_type, qty, source_type)
         VALUES ($1, $2, $3, 'adjustment_out', -1, 'adjustment')`,
        [companyId, storeAId, variantId],
      ),
    ).rejects.toThrow();
  });

  it("accepts an adjustment with a reason_code", async () => {
    const variantId = await newItemVariant();
    await recordStockMovement(client, {
      companyId, storeId: storeAId, itemVariantId: variantId, movementType: "adjustment_in",
      qty: 5, explicitUnitCost: 3, reasonCode: "opening balance", sourceType: "adjustment", createdBy: userId,
    });
    expect((await balance(storeAId, variantId)).qty).toBe(5);
  });
});

describe("transfers conserve total quantity", () => {
  it("moves qty from source to dest at the exact source cost", async () => {
    const variantId = await newItemVariant();
    await recordStockMovement(client, {
      companyId, storeId: storeAId, itemVariantId: variantId, movementType: "receipt",
      qty: 15, explicitUnitCost: 25, sourceType: "test", createdBy: userId,
    });

    const before = { a: await balance(storeAId, variantId), b: await balance(storeBId, variantId) };
    const totalBefore = before.a.qty + before.b.qty;

    const result = await transferStock(client, {
      companyId, sourceStoreId: storeAId, destStoreId: storeBId, itemVariantId: variantId, qty: 6, createdBy: userId,
    });

    const after = { a: await balance(storeAId, variantId), b: await balance(storeBId, variantId) };
    const totalAfter = after.a.qty + after.b.qty;

    expect(totalAfter).toBe(totalBefore);
    expect(after.a.qty).toBe(9);
    expect(after.b.qty).toBe(6);
    expect(result.unitCost).toBe(25);
    expect(after.b.avgCost).toBe(25); // dest inherits source's cost, not its own (empty) average

    const linked = await client.query(`SELECT linked_movement_id FROM stock_movements WHERE id = $1`, [result.transferInId]);
    expect(linked.rows[0].linked_movement_id).toBe(result.transferOutId);
  });
});

describe("stocktake: snapshot, count, variance posting", () => {
  it("posts a shortfall as shrinkage against Inventory Adjustments", async () => {
    const variantId = await newItemVariant();
    await recordStockMovement(client, {
      companyId, storeId: storeAId, itemVariantId: variantId, movementType: "receipt",
      qty: 50, explicitUnitCost: 4, sourceType: "test", createdBy: userId,
    });

    const stocktakeId = await createStocktake(client, {
      companyId, storeId: storeAId, stocktakeDate: "2026-03-20", fiscalPeriodId: periodId,
      itemVariantIds: [variantId], createdBy: userId,
    });

    const line = await client.query(`SELECT id, snapshot_qty FROM stocktake_lines WHERE stocktake_id = $1`, [stocktakeId]);
    expect(Number(line.rows[0].snapshot_qty)).toBe(50);

    await recordStocktakeCount(client, line.rows[0].id, 47); // 3 units missing

    await expect(
      client.query(`UPDATE stocktakes SET document_status = 'posted' WHERE id = $1`, [stocktakeId]),
    ).rejects.toThrow(); // can't post directly without a journal — must go through postStocktake

    await postStocktake(client, stocktakeId, userId);

    expect((await balance(storeAId, variantId)).qty).toBe(47);

    const stocktake = await client.query(`SELECT document_status, journal_id FROM stocktakes WHERE id = $1`, [stocktakeId]);
    expect(stocktake.rows[0].document_status).toBe("posted");

    const journalLines = await client.query(
      `SELECT account_id, debit_amount, credit_amount FROM journal_lines WHERE journal_id = $1`,
      [stocktake.rows[0].journal_id],
    );
    const debitTotal = journalLines.rows.reduce((s, r) => s + Number(r.debit_amount), 0);
    const creditTotal = journalLines.rows.reduce((s, r) => s + Number(r.credit_amount), 0);
    expect(debitTotal).toBeCloseTo(creditTotal, 2);
    expect(debitTotal).toBeCloseTo(12, 2); // 3 units * 4.00 cost
  });

  it("rejects posting while any line is uncounted", async () => {
    const variantId = await newItemVariant();
    const stocktakeId = await createStocktake(client, {
      companyId, storeId: storeAId, stocktakeDate: "2026-03-21", fiscalPeriodId: periodId,
      itemVariantIds: [variantId], createdBy: userId,
    });
    await expect(postStocktake(client, stocktakeId, userId)).rejects.toThrow(/uncounted/);
  });
});

describe("sales integration: COGS at the moment of sale", () => {
  it("books COGS at the cost the stock actually carried, and reverses it correctly on return", async () => {
    const variantId = await newItemVariant();
    await recordStockMovement(client, {
      companyId, storeId: storeAId, itemVariantId: variantId, movementType: "receipt",
      qty: 20, explicitUnitCost: 30, sourceType: "test", createdBy: userId,
    });

    const invoiceId = await createSalesInvoice(client, {
      companyId, storeId: storeAId, invoiceChannel: "pos", zatcaInvoiceCategory: "simplified",
      invoiceDate: "2026-03-22", fiscalPeriodId: periodId, customerId: null, salespersonId: null, priceListId: null,
      createdBy: userId,
      lines: [{ itemVariantId: variantId, itemDescription: "Item", qty: 4, unitPrice: 57.5, discountAmount: 0, vatRate: 15, priceIncludesVat: true }],
      payments: [{ paymentMethod: "cash", amount: 230 }],
    });
    await postSalesInvoice(client, invoiceId, userId);

    expect((await balance(storeAId, variantId)).qty).toBe(16); // 20 - 4

    const invoice = await client.query(`SELECT journal_id FROM sales_invoices WHERE id = $1`, [invoiceId]);
    const cogsLines = await client.query(
      `SELECT jl.debit_amount, jl.credit_amount FROM journal_lines jl
       JOIN chart_of_accounts coa ON coa.id = jl.account_id
       WHERE jl.journal_id = $1 AND coa.account_code IN ('5100', '1130')`,
      [invoice.rows[0].journal_id],
    );
    const cogsDebit = cogsLines.rows.find((r) => Number(r.debit_amount) > 0);
    const inventoryCredit = cogsLines.rows.find((r) => Number(r.credit_amount) > 0);
    expect(Number(cogsDebit!.debit_amount)).toBe(120); // 4 units * 30
    expect(Number(inventoryCredit!.credit_amount)).toBe(120);

    const sourceLine = await client.query(`SELECT id FROM sales_invoice_lines WHERE invoice_id = $1`, [invoiceId]);
    const creditNoteId = await createCreditNote(client, {
      companyId, storeId: storeAId, originalInvoiceId: invoiceId, zatcaInvoiceCategory: "simplified",
      creditNoteDate: "2026-03-23", fiscalPeriodId: periodId, customerId: null, reason: "return",
      createdBy: userId,
      lines: [{ sourceLineId: sourceLine.rows[0].id, itemVariantId: variantId, itemDescription: "Item", qty: 1, unitPrice: 57.5, discountAmount: 0, vatRate: 15, priceIncludesVat: true }],
    });
    await postCreditNote(client, creditNoteId, userId);

    // Returned 1 unit goes back to inventory at the ORIGINAL cost (30), not
    // whatever the average happens to be now.
    expect((await balance(storeAId, variantId)).qty).toBe(17); // 16 + 1

    const returnMovement = await client.query(
      `SELECT unit_cost FROM stock_movements WHERE source_type = 'credit_note' AND source_id = $1`,
      [creditNoteId],
    );
    expect(Number(returnMovement.rows[0].unit_cost)).toBe(30);
  });
});
