/**
 * Fixed assets: acquisition (register + a simple cash-purchase journal),
 * monthly straight-line depreciation runs, and disposal.
 *
 * Acquisition here assumes a direct cash purchase (Dr Fixed Asset / Cr
 * Cash) for simplicity — capitalizing a supplier invoice line to a fixed
 * asset account instead of an expense/inventory account (the normal path
 * for a financed purchase) would extend src/purchasing/purchasingService.ts
 * and isn't built in this phase.
 */

import type { Client } from "pg";
import { round2 } from "../money.js";

async function nextDocumentNumber(
  client: Client,
  companyId: string,
  documentType: string,
  fiscalYear: number,
  prefix: string,
): Promise<string> {
  const r = await client.query<{ fn_next_document_number: string }>(
    `SELECT fn_next_document_number($1, $2, $3, $4) AS fn_next_document_number`,
    [companyId, documentType, fiscalYear, prefix],
  );
  return r.rows[0]!.fn_next_document_number;
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

export interface AcquireFixedAssetParams {
  companyId: string;
  assetCategoryId: string;
  storeId: string | null;
  assetCode: string;
  nameEn: string;
  nameAr: string;
  acquisitionDate: string; // YYYY-MM-DD
  acquisitionCost: number;
  salvageValue: number;
  useful_lifeMonthsOverride?: number | null;
  fiscalPeriodId: string;
  createdBy: string;
}

export async function acquireFixedAsset(client: Client, params: AcquireFixedAssetParams): Promise<string> {
  const category = await client.query<{ default_useful_life_months: number; asset_account_id: string }>(
    `SELECT default_useful_life_months, asset_account_id FROM asset_categories WHERE id = $1 AND company_id = $2`,
    [params.assetCategoryId, params.companyId],
  );
  if (category.rows.length === 0) {
    throw new Error(`asset category ${params.assetCategoryId} not found`);
  }
  const usefulLifeMonths = params.useful_lifeMonthsOverride ?? category.rows[0]!.default_useful_life_months;

  const fiscalYear = Number(params.acquisitionDate.slice(0, 4));
  const journalNumber = await nextDocumentNumber(client, params.companyId, "journal", fiscalYear, "GJ-");
  const cashAccountId = await getAccountId(client, params.companyId, "1110");

  const journalResult = await client.query<{ id: string }>(
    `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type, created_by)
     VALUES ($1, $2, $3, $4, 'fixed_asset_acquisition', $5)
     RETURNING id`,
    [params.companyId, journalNumber, params.acquisitionDate, params.fiscalPeriodId, params.createdBy],
  );
  const journalId = journalResult.rows[0]!.id;

  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
     VALUES ($1, $2, 1, $3, $4, 'fixed asset acquisition')`,
    [params.companyId, journalId, category.rows[0]!.asset_account_id, params.acquisitionCost],
  );
  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
     VALUES ($1, $2, 2, $3, $4, 'fixed asset acquisition')`,
    [params.companyId, journalId, cashAccountId, params.acquisitionCost],
  );
  await client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journalId]);

  const asset = await client.query<{ id: string }>(
    `INSERT INTO fixed_assets
       (company_id, asset_category_id, store_id, asset_code, name_en, name_ar,
        acquisition_date, acquisition_cost, salvage_value, useful_life_months,
        acquisition_journal_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      params.companyId,
      params.assetCategoryId,
      params.storeId,
      params.assetCode,
      params.nameEn,
      params.nameAr,
      params.acquisitionDate,
      params.acquisitionCost,
      params.salvageValue,
      usefulLifeMonths,
      journalId,
      params.createdBy,
    ],
  );

  return asset.rows[0]!.id;
}

export interface CreateDepreciationRunParams {
  companyId: string;
  fiscalPeriodId: string;
  runDate: string;
  createdBy: string;
}

export async function createDepreciationRun(client: Client, params: CreateDepreciationRunParams): Promise<string> {
  const fiscalYear = Number(params.runDate.slice(0, 4));
  const documentNumber = await nextDocumentNumber(client, params.companyId, "depreciation_run", fiscalYear, "DEP-");

  const result = await client.query<{ id: string }>(
    `INSERT INTO depreciation_runs (company_id, fiscal_period_id, document_number, run_date, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [params.companyId, params.fiscalPeriodId, documentNumber, params.runDate, params.createdBy],
  );
  return result.rows[0]!.id;
}

interface EligibleAsset {
  id: string;
  asset_category_id: string;
  acquisition_cost: string;
  salvage_value: string;
  accumulated_depreciation: string;
  useful_life_months: number;
}

export async function postDepreciationRun(client: Client, runId: string, postedBy: string): Promise<void> {
  const runResult = await client.query<{ company_id: string; fiscal_period_id: string; run_date: Date }>(
    `SELECT company_id, fiscal_period_id, run_date FROM depreciation_runs WHERE id = $1`,
    [runId],
  );
  if (runResult.rows.length === 0) throw new Error(`depreciation run ${runId} not found`);
  const run = runResult.rows[0]!;

  // Eligible: active (not disposed, not already fully depreciated),
  // acquired on or before this run's date.
  const assets = await client.query<EligibleAsset>(
    `SELECT id, asset_category_id, acquisition_cost, salvage_value, accumulated_depreciation, useful_life_months
     FROM fixed_assets
     WHERE company_id = $1 AND status = 'active' AND acquisition_date <= $2`,
    [run.company_id, run.run_date],
  );
  if (assets.rows.length === 0) {
    throw new Error(`depreciation run ${runId} has no eligible assets to depreciate`);
  }

  const lineAmountsByAsset = new Map<string, number>();
  for (const asset of assets.rows) {
    const depreciableBase = Number(asset.acquisition_cost) - Number(asset.salvage_value);
    const monthly = round2(depreciableBase / asset.useful_life_months);
    const remaining = round2(depreciableBase - Number(asset.accumulated_depreciation));
    const amount = Math.min(monthly, remaining);
    if (amount > 0) {
      lineAmountsByAsset.set(asset.id, amount);
    }
  }
  if (lineAmountsByAsset.size === 0) {
    throw new Error(`depreciation run ${runId}: every eligible asset is already fully depreciated`);
  }

  for (const [assetId, amount] of lineAmountsByAsset) {
    await client.query(
      `INSERT INTO depreciation_run_lines (company_id, depreciation_run_id, fixed_asset_id, depreciation_amount)
       VALUES ($1, $2, $3, $4)`,
      [run.company_id, runId, assetId, amount],
    );
  }

  // Aggregate by category so the journal has one expense/accum-depreciation
  // pair per category, not one pair per asset.
  const totalsByCategory = new Map<string, number>();
  for (const asset of assets.rows) {
    const amount = lineAmountsByAsset.get(asset.id);
    if (amount === undefined) continue;
    totalsByCategory.set(asset.asset_category_id, round2((totalsByCategory.get(asset.asset_category_id) ?? 0) + amount));
  }

  const fiscalYear = Number(run.run_date.toISOString().slice(0, 4));
  const journalNumber = await nextDocumentNumber(client, run.company_id, "journal", fiscalYear, "GJ-");
  const journalResult = await client.query<{ id: string }>(
    `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type, source_id, created_by)
     VALUES ($1, $2, $3, $4, 'depreciation_run', $5, $6)
     RETURNING id`,
    [run.company_id, journalNumber, run.run_date, run.fiscal_period_id, runId, postedBy],
  );
  const journalId = journalResult.rows[0]!.id;

  let lineNumber = 0;
  for (const [categoryId, amount] of totalsByCategory) {
    const category = await client.query<{ depreciation_expense_account_id: string; accumulated_depreciation_account_id: string }>(
      `SELECT depreciation_expense_account_id, accumulated_depreciation_account_id FROM asset_categories WHERE id = $1`,
      [categoryId],
    );
    const { depreciation_expense_account_id, accumulated_depreciation_account_id } = category.rows[0]!;

    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'depreciation expense')`,
      [run.company_id, journalId, lineNumber, depreciation_expense_account_id, amount],
    );
    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'accumulated depreciation')`,
      [run.company_id, journalId, lineNumber, accumulated_depreciation_account_id, amount],
    );
  }

  await client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journalId]);
  await client.query(
    `UPDATE depreciation_runs SET document_status = 'posted', posted_by = $2, journal_id = $3 WHERE id = $1`,
    [runId, postedBy, journalId],
  );

  for (const [assetId, amount] of lineAmountsByAsset) {
    await client.query(
      `UPDATE fixed_assets
         SET accumulated_depreciation = accumulated_depreciation + $2,
             status = CASE WHEN accumulated_depreciation + $2 >= acquisition_cost - salvage_value THEN 'fully_depreciated' ELSE status END
       WHERE id = $1`,
      [assetId, amount],
    );
  }
}

export interface DisposeFixedAssetParams {
  assetId: string;
  disposalDate: string;
  proceeds: number;
  fiscalPeriodId: string;
  postedBy: string;
}

export async function disposeFixedAsset(client: Client, params: DisposeFixedAssetParams): Promise<void> {
  const assetResult = await client.query<{
    company_id: string;
    asset_category_id: string;
    acquisition_cost: string;
    accumulated_depreciation: string;
    status: string;
  }>(
    `SELECT company_id, asset_category_id, acquisition_cost, accumulated_depreciation, status
     FROM fixed_assets WHERE id = $1`,
    [params.assetId],
  );
  if (assetResult.rows.length === 0) throw new Error(`fixed asset ${params.assetId} not found`);
  const asset = assetResult.rows[0]!;
  if (asset.status === "disposed") {
    throw new Error(`fixed asset ${params.assetId} is already disposed`);
  }

  const category = await client.query<{ asset_account_id: string; accumulated_depreciation_account_id: string }>(
    `SELECT asset_account_id, accumulated_depreciation_account_id FROM asset_categories WHERE id = $1`,
    [asset.asset_category_id],
  );
  const { asset_account_id, accumulated_depreciation_account_id } = category.rows[0]!;

  const cost = Number(asset.acquisition_cost);
  const accumulatedDepreciation = Number(asset.accumulated_depreciation);
  const bookValue = round2(cost - accumulatedDepreciation);
  const gainLoss = round2(params.proceeds - bookValue);

  const cashAccountId = await getAccountId(client, asset.company_id, "1110");
  const fiscalYear = Number(params.disposalDate.slice(0, 4));
  const journalNumber = await nextDocumentNumber(client, asset.company_id, "journal", fiscalYear, "GJ-");

  const journalResult = await client.query<{ id: string }>(
    `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type, source_id, created_by)
     VALUES ($1, $2, $3, $4, 'fixed_asset_disposal', $5, $6)
     RETURNING id`,
    [asset.company_id, journalNumber, params.disposalDate, params.fiscalPeriodId, params.assetId, params.postedBy],
  );
  const journalId = journalResult.rows[0]!.id;

  let lineNumber = 0;
  if (accumulatedDepreciation > 0) {
    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'remove accumulated depreciation on disposal')`,
      [asset.company_id, journalId, lineNumber, accumulated_depreciation_account_id, accumulatedDepreciation],
    );
  }
  if (params.proceeds > 0) {
    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'disposal proceeds')`,
      [asset.company_id, journalId, lineNumber, cashAccountId, params.proceeds],
    );
  }
  lineNumber += 1;
  await client.query(
    `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
     VALUES ($1, $2, $3, $4, $5, 'remove asset at cost')`,
    [asset.company_id, journalId, lineNumber, asset_account_id, cost],
  );

  if (gainLoss > 0) {
    const gainAccountId = await getAccountId(client, asset.company_id, "4200");
    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'gain on disposal')`,
      [asset.company_id, journalId, lineNumber, gainAccountId, gainLoss],
    );
  } else if (gainLoss < 0) {
    const lossAccountId = await getAccountId(client, asset.company_id, "5210");
    lineNumber += 1;
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, description)
       VALUES ($1, $2, $3, $4, $5, 'loss on disposal')`,
      [asset.company_id, journalId, lineNumber, lossAccountId, Math.abs(gainLoss)],
    );
  }

  await client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journalId]);
  await client.query(
    `UPDATE fixed_assets SET status = 'disposed', disposed_at = $2, disposal_proceeds = $3, disposal_journal_id = $4 WHERE id = $1`,
    [params.assetId, params.disposalDate, params.proceeds, journalId],
  );
}
