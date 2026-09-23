import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { newClient } from "./helpers.js";

let client: Client;
let companyId: string;
let openPeriodId: string;
let closedPeriodId: string;
let cashAccountId: string;
let revenueAccountId: string;
let headerAccountId: string;
let journalCounter = 0;

function nextJournalNumber() {
  journalCounter += 1;
  return `TESTJRNL-${journalCounter}`;
}

async function createDraftJournal(periodId: string) {
  const j = await client.query(
    `INSERT INTO journals (company_id, journal_number, journal_date, fiscal_period_id, source_type)
     VALUES ($1, $2, '2026-03-15', $3, 'manual') RETURNING id`,
    [companyId, nextJournalNumber(), periodId],
  );
  return j.rows[0].id as string;
}

beforeAll(async () => {
  client = newClient();
  await client.connect();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co P3', 'شركة') RETURNING id`,
    [`TEST_P3_${randomUUID().slice(0, 8)}`],
  );
  companyId = company.rows[0].id;

  const fy = await client.query(
    `INSERT INTO fiscal_years (company_id, year_name, start_date, end_date) VALUES ($1, 'FY2026', '2026-01-01', '2026-12-31') RETURNING id`,
    [companyId],
  );
  const fyId = fy.rows[0].id;

  const openPeriod = await client.query(
    `INSERT INTO fiscal_periods (fiscal_year_id, company_id, period_number, start_date, end_date, status)
     VALUES ($1, $2, 3, '2026-03-01', '2026-03-31', 'open') RETURNING id`,
    [fyId, companyId],
  );
  openPeriodId = openPeriod.rows[0].id;

  const closedPeriod = await client.query(
    `INSERT INTO fiscal_periods (fiscal_year_id, company_id, period_number, start_date, end_date, status)
     VALUES ($1, $2, 1, '2026-01-01', '2026-01-31', 'closed') RETURNING id`,
    [fyId, companyId],
  );
  closedPeriodId = closedPeriod.rows[0].id;

  const cash = await client.query(
    `INSERT INTO chart_of_accounts (company_id, account_code, name_en, name_ar, account_type, normal_balance)
     VALUES ($1, '1100', 'Cash', 'نقد', 'asset', 'debit') RETURNING id`,
    [companyId],
  );
  cashAccountId = cash.rows[0].id;

  const revenue = await client.query(
    `INSERT INTO chart_of_accounts (company_id, account_code, name_en, name_ar, account_type, normal_balance)
     VALUES ($1, '4100', 'Sales Revenue', 'إيرادات المبيعات', 'revenue', 'credit') RETURNING id`,
    [companyId],
  );
  revenueAccountId = revenue.rows[0].id;

  const header = await client.query(
    `INSERT INTO chart_of_accounts (company_id, account_code, name_en, name_ar, account_type, normal_balance, is_header)
     VALUES ($1, '1000', 'Assets', 'الأصول', 'asset', 'debit', true) RETURNING id`,
    [companyId],
  );
  headerAccountId = header.rows[0].id;
});

afterAll(async () => {
  // Test cleanup needs to remove posted journals too, which are otherwise
  // immutable by design — the same narrow bypass a real superuser purge
  // script would use, never set by application code.
  await client.query(`SET app.bypass_immutability = 'true'`);
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journal_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM journals WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM chart_of_accounts WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("posting a balanced journal", () => {
  it("succeeds and sets posted_at/posted_by", async () => {
    const journalId = await createDraftJournal(openPeriodId);
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount) VALUES ($1, $2, 1, $3, 100)`,
      [companyId, journalId, cashAccountId],
    );
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount) VALUES ($1, $2, 2, $3, 100)`,
      [companyId, journalId, revenueAccountId],
    );

    await client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journalId]);

    const result = await client.query(`SELECT document_status, posted_at FROM journals WHERE id = $1`, [journalId]);
    expect(result.rows[0].document_status).toBe("posted");
    expect(result.rows[0].posted_at).not.toBeNull();
  });
});

describe("posting an unbalanced journal", () => {
  it("is rejected and leaves no partial entries (journal stays draft)", async () => {
    const journalId = await createDraftJournal(openPeriodId);
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount) VALUES ($1, $2, 1, $3, 100)`,
      [companyId, journalId, cashAccountId],
    );
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount) VALUES ($1, $2, 2, $3, 90)`,
      [companyId, journalId, revenueAccountId],
    );

    await expect(
      client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journalId]),
    ).rejects.toThrow(/not balanced/);

    const result = await client.query(`SELECT document_status, posted_at FROM journals WHERE id = $1`, [journalId]);
    expect(result.rows[0].document_status).toBe("draft");
    expect(result.rows[0].posted_at).toBeNull();
  });

  it("rejects posting a journal with zero lines", async () => {
    const journalId = await createDraftJournal(openPeriodId);
    await expect(
      client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journalId]),
    ).rejects.toThrow(/no lines/);
  });
});

describe("posted journal immutability", () => {
  it("cannot be edited after posting", async () => {
    const journalId = await createDraftJournal(openPeriodId);
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount) VALUES ($1, $2, 1, $3, 50)`,
      [companyId, journalId, cashAccountId],
    );
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount) VALUES ($1, $2, 2, $3, 50)`,
      [companyId, journalId, revenueAccountId],
    );
    await client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journalId]);

    await expect(
      client.query(`UPDATE journals SET memo = 'edited after posting' WHERE id = $1`, [journalId]),
    ).rejects.toThrow(/immutable|posted/);

    await expect(
      client.query(`DELETE FROM journals WHERE id = $1`, [journalId]),
    ).rejects.toThrow(/posted/);
  });

  it("rejects adding, editing, or deleting lines after posting", async () => {
    const journalId = await createDraftJournal(openPeriodId);
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount) VALUES ($1, $2, 1, $3, 20)`,
      [companyId, journalId, cashAccountId],
    );
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount) VALUES ($1, $2, 2, $3, 20)`,
      [companyId, journalId, revenueAccountId],
    );
    await client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journalId]);

    await expect(
      client.query(
        `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount) VALUES ($1, $2, 3, $3, 5)`,
        [companyId, journalId, cashAccountId],
      ),
    ).rejects.toThrow(/immutable/);

    await expect(
      client.query(`UPDATE journal_lines SET debit_amount = 999 WHERE journal_id = $1 AND line_number = 1`, [journalId]),
    ).rejects.toThrow(/immutable/);

    await expect(
      client.query(`DELETE FROM journal_lines WHERE journal_id = $1 AND line_number = 1`, [journalId]),
    ).rejects.toThrow(/immutable/);
  });
});

describe("closed periods", () => {
  it("reject posting", async () => {
    const journalId = await createDraftJournal(closedPeriodId);
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount) VALUES ($1, $2, 1, $3, 10)`,
      [companyId, journalId, cashAccountId],
    );
    await client.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, credit_amount) VALUES ($1, $2, 2, $3, 10)`,
      [companyId, journalId, revenueAccountId],
    );

    await expect(
      client.query(`UPDATE journals SET document_status = 'posted' WHERE id = $1`, [journalId]),
    ).rejects.toThrow(/closed/);
  });
});

describe("account validation", () => {
  it("rejects a line posted to a header (non-postable) account", async () => {
    const journalId = await createDraftJournal(openPeriodId);
    await expect(
      client.query(
        `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount) VALUES ($1, $2, 1, $3, 10)`,
        [companyId, journalId, headerAccountId],
      ),
    ).rejects.toThrow(/header account/);
  });

  it("rejects a line with both a debit and a credit amount", async () => {
    const journalId = await createDraftJournal(openPeriodId);
    await expect(
      client.query(
        `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id, debit_amount, credit_amount) VALUES ($1, $2, 1, $3, 10, 10)`,
        [companyId, journalId, cashAccountId],
      ),
    ).rejects.toThrow();
  });

  it("rejects a line with neither a debit nor a credit amount", async () => {
    const journalId = await createDraftJournal(openPeriodId);
    await expect(
      client.query(
        `INSERT INTO journal_lines (company_id, journal_id, line_number, account_id) VALUES ($1, $2, 1, $3)`,
        [companyId, journalId, cashAccountId],
      ),
    ).rejects.toThrow();
  });
});

describe("fn_amounts_balance", () => {
  it("is true when net + vat = gross and false otherwise", async () => {
    const ok = await client.query(`SELECT fn_amounts_balance(100, 15, 115) AS ok`);
    expect(ok.rows[0].ok).toBe(true);

    const bad = await client.query(`SELECT fn_amounts_balance(100, 15, 116) AS ok`);
    expect(bad.rows[0].ok).toBe(false);
  });
});
