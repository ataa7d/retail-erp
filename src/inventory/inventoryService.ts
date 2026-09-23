/**
 * Inventory service: records stock movements, runs transfers, and manages
 * stocktakes. The actual weighted-average costing and balance maintenance
 * live in the trg_stock_movements_process trigger (migration 0025) — this
 * file just builds correctly-shaped movement rows and, where a movement
 * carries a GL impact (stocktake variance), the matching journal.
 */

import type { Client } from "pg";

export interface RecordMovementParams {
  companyId: string;
  storeId: string;
  itemVariantId: string;
  movementType:
    | "receipt"
    | "issue"
    | "transfer_out"
    | "transfer_in"
    | "adjustment_in"
    | "adjustment_out"
    | "sales_return"
    | "purchase_return"
    | "stocktake_variance";
  qty: number; // signed
  explicitUnitCost?: number; // hint for incoming movements only; ignored for outgoing
  reasonCode?: string | null;
  sourceType: string;
  sourceId?: string | null;
  sourceLineId?: string | null;
  linkedMovementId?: string | null;
  movementAt?: string; // defaults to now()
  createdBy?: string | null;
}

export interface RecordedMovement {
  id: string;
  unitCost: number;
  totalCost: number;
}

export async function recordStockMovement(client: Client, p: RecordMovementParams): Promise<RecordedMovement> {
  const r = await client.query<{ id: string; unit_cost: string; total_cost: string }>(
    `INSERT INTO stock_movements
       (company_id, store_id, item_variant_id, movement_type, qty, unit_cost,
        reason_code, source_type, source_id, source_line_id, linked_movement_id, movement_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, now()), $13)
     RETURNING id, unit_cost, total_cost`,
    [
      p.companyId,
      p.storeId,
      p.itemVariantId,
      p.movementType,
      p.qty,
      p.explicitUnitCost ?? null,
      p.reasonCode ?? null,
      p.sourceType,
      p.sourceId ?? null,
      p.sourceLineId ?? null,
      p.linkedMovementId ?? null,
      p.movementAt ?? null,
      p.createdBy ?? null,
    ],
  );
  const row = r.rows[0]!;
  return { id: row.id, unitCost: Number(row.unit_cost), totalCost: Number(row.total_cost) };
}

export interface TransferStockParams {
  companyId: string;
  sourceStoreId: string;
  destStoreId: string;
  itemVariantId: string;
  qty: number; // positive quantity to move
  reasonCode?: string | null;
  createdBy?: string | null;
}

export interface TransferResult {
  transferOutId: string;
  transferInId: string;
  unitCost: number;
}

/** Two linked movements conserving total quantity: -qty at source, +qty at
 * dest, dest costed at exactly what the goods left the source at. */
export async function transferStock(client: Client, p: TransferStockParams): Promise<TransferResult> {
  const out = await recordStockMovement(client, {
    companyId: p.companyId,
    storeId: p.sourceStoreId,
    itemVariantId: p.itemVariantId,
    movementType: "transfer_out",
    qty: -Math.abs(p.qty),
    reasonCode: p.reasonCode,
    sourceType: "transfer",
    createdBy: p.createdBy,
  });

  const into = await recordStockMovement(client, {
    companyId: p.companyId,
    storeId: p.destStoreId,
    itemVariantId: p.itemVariantId,
    movementType: "transfer_in",
    qty: Math.abs(p.qty),
    explicitUnitCost: out.unitCost, // carry the exact cost the goods left at
    reasonCode: p.reasonCode,
    sourceType: "transfer",
    linkedMovementId: out.id,
    createdBy: p.createdBy,
  });

  return { transferOutId: out.id, transferInId: into.id, unitCost: out.unitCost };
}

export interface CreateStocktakeParams {
  companyId: string;
  storeId: string;
  stocktakeDate: string;
  fiscalPeriodId: string;
  itemVariantIds: string[]; // items to include in the count
  createdBy?: string | null;
}

async function nextDocumentNumber(client: Client, companyId: string, documentType: string, fiscalYear: number, prefix: string) {
  const r = await client.query<{ fn_next_document_number: string }>(
    `SELECT fn_next_document_number($1, $2, $3, $4) AS fn_next_document_number`,
    [companyId, documentType, fiscalYear, prefix],
  );
  return r.rows[0]!.fn_next_document_number;
}

/** Snapshots current stock_balances for the given variants as the count's
 * starting point — this snapshot is what counted_qty is compared against,
 * even if other movements happen concurrently during the physical count. */
export async function createStocktake(client: Client, p: CreateStocktakeParams): Promise<string> {
  const fiscalYear = Number(p.stocktakeDate.slice(0, 4));
  const documentNumber = await nextDocumentNumber(client, p.companyId, "stocktake", fiscalYear, "ST-");

  const header = await client.query<{ id: string }>(
    `INSERT INTO stocktakes (company_id, store_id, document_number, stocktake_date, fiscal_period_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [p.companyId, p.storeId, documentNumber, p.stocktakeDate, p.fiscalPeriodId, p.createdBy ?? null],
  );
  const stocktakeId = header.rows[0]!.id;

  for (const itemVariantId of p.itemVariantIds) {
    const balance = await client.query<{ qty_on_hand: string }>(
      `SELECT qty_on_hand FROM stock_balances WHERE store_id = $1 AND item_variant_id = $2`,
      [p.storeId, itemVariantId],
    );
    const snapshotQty = balance.rows[0]?.qty_on_hand ?? "0";
    await client.query(
      `INSERT INTO stocktake_lines (company_id, stocktake_id, item_variant_id, snapshot_qty) VALUES ($1, $2, $3, $4)`,
      [p.companyId, stocktakeId, itemVariantId, snapshotQty],
    );
  }

  return stocktakeId;
}

export async function recordStocktakeCount(client: Client, stocktakeLineId: string, countedQty: number): Promise<void> {
  await client.query(`UPDATE stocktake_lines SET counted_qty = $2 WHERE id = $1`, [stocktakeLineId, countedQty]);
}

/** Posts variance movements for every counted line whose variance is
 * non-zero, then (if there was any variance) books the net value impact to
 * Inventory Adjustments vs Inventory Asset, in one journal. */
export async function postStocktake(client: Client, stocktakeId: string, postedBy: string): Promise<void> {
  const stocktakeResult = await client.query(
    `SELECT company_id, store_id, stocktake_date, fiscal_period_id FROM stocktakes WHERE id = $1`,
    [stocktakeId],
  );
  if (stocktakeResult.rows.length === 0) throw new Error(`stocktake ${stocktakeId} not found`);
  const stocktake = stocktakeResult.rows[0]!;

  const lines = await client.query<{ id: string; item_variant_id: string; variance_qty: string }>(
    `SELECT id, item_variant_id, variance_qty FROM stocktake_lines WHERE stocktake_id = $1 AND variance_qty <> 0`,
    [stocktakeId],
  );

  let journalId: string | null = null;
  let totalVarianceValue = 0;

  if (lines.rows.length > 0) {
    const inventoryAccountId = await getAccountId(client, stocktake.company_id, "1130");
    const adjustmentAccountId = await getAccountId(client, stocktake.company_id, "5110");

    const fiscalYear = Number(stocktake.stocktake_date.toISOString().slice(0, 4));
    // All journals share one numbering series ('journal') regardless of
    // source — a real general-journal voucher sequence, not per-module.
    const journalNumber = await nextDocumentNumber(client, stocktake.company_id, "journal", fiscalYear, "GJ-");
    const journalResult = await client.query<{ id: string }>(
      `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type, source_id, created_by)
       VALUES ($1, $2, $3, $4, 'stocktake', $5, $6) RETURNING id`,
      [stocktake.company_id, journalNumber, stocktake.stocktake_date, stocktake.fiscal_period_id, stocktakeId, postedBy],
    );
    journalId = journalResult.rows[0]!.id;

    for (const line of lines.rows) {
      const movement = await recordStockMovement(client, {
        companyId: stocktake.company_id,
        storeId: stocktake.store_id,
        itemVariantId: line.item_variant_id,
        movementType: "stocktake_variance",
        qty: Number(line.variance_qty),
        sourceType: "stocktake",
        sourceId: stocktakeId,
        sourceLineId: line.id,
        createdBy: postedBy,
      });
      totalVarianceValue += movement.totalCost;
    }

    totalVarianceValue = Math.round(totalVarianceValue * 100) / 100;

    let lineNumber = 1;
    if (totalVarianceValue > 0) {
      // found more stock than expected: inventory value increases, offset
      // as a credit to the adjustments account (a gain)
      await client.query(
        `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
         VALUES ($1, $2, $3, $4, $5, 'stocktake variance: found stock')`,
        [stocktake.company_id, journalId, lineNumber, inventoryAccountId, totalVarianceValue],
      );
      lineNumber += 1;
      await client.query(
        `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
         VALUES ($1, $2, $3, $4, $5, 'stocktake variance: found stock')`,
        [stocktake.company_id, journalId, lineNumber, adjustmentAccountId, totalVarianceValue],
      );
    } else if (totalVarianceValue < 0) {
      const shortfall = Math.abs(totalVarianceValue);
      await client.query(
        `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
         VALUES ($1, $2, $3, $4, $5, 'stocktake variance: shrinkage')`,
        [stocktake.company_id, journalId, lineNumber, adjustmentAccountId, shortfall],
      );
      lineNumber += 1;
      await client.query(
        `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
         VALUES ($1, $2, $3, $4, $5, 'stocktake variance: shrinkage')`,
        [stocktake.company_id, journalId, lineNumber, inventoryAccountId, shortfall],
      );
    }

    if (totalVarianceValue !== 0) {
      await client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journalId]);
    }
  }

  await client.query(
    `UPDATE stocktakes SET document_status = 'posted', posted_by = $2, journal_id = $3 WHERE id = $1`,
    [stocktakeId, postedBy, journalId],
  );
}

async function getAccountId(client: Client, companyId: string, code: string): Promise<string> {
  const r = await client.query<{ id: string }>(
    `SELECT id FROM chart_of_accounts WHERE company_id = $1 AND account_code = $2`,
    [companyId, code],
  );
  if (r.rows.length === 0) {
    throw new Error(`chart of accounts is missing required account ${code} for company ${companyId}`);
  }
  return r.rows[0]!.id;
}
