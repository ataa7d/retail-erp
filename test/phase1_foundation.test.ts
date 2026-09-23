import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { newClient } from "./helpers.js";

// These tests run against a real, migrated Postgres database
// (docker/docker-compose.yml, then `npm run migrate`). They exist to prove
// the Phase 1 schema's constraints actually hold, not just that the SQL
// parses.

let client: Client;
let companyAId: string;
let companyBId: string;

beforeAll(async () => {
  client = newClient();
  await client.connect();

  const a = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co A', 'شركة أ') RETURNING id`,
    [`TEST_A_${randomUUID().slice(0, 8)}`],
  );
  companyAId = a.rows[0].id;

  const b = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co B', 'شركة ب') RETURNING id`,
    [`TEST_B_${randomUUID().slice(0, 8)}`],
  );
  companyBId = b.rows[0].id;
});

afterAll(async () => {
  // Cascade cleanup in dependency order. Test data only.
  await client.query(`DELETE FROM audit_log WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM number_sequences WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM chart_of_accounts WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM user_roles WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id IN ($1, $2))`, [companyAId, companyBId]);
  await client.query(`DELETE FROM roles WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM stores WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM branches WHERE company_id IN ($1, $2)`, [companyAId, companyBId]);
  await client.query(`DELETE FROM companies WHERE id IN ($1, $2)`, [companyAId, companyBId]);
  await client.end();
});

describe("company scoping", () => {
  it("rejects assigning a role from company A to a user in company B", async () => {
    const user = await client.query(
      `INSERT INTO users (email, password_hash, full_name_en, full_name_ar)
       VALUES ($1, 'x', 'Test User', 'مستخدم اختبار') RETURNING id`,
      [`user_${randomUUID()}@test.local`],
    );
    const userId = user.rows[0].id;

    const role = await client.query(
      `INSERT INTO roles (company_id, name) VALUES ($1, 'Role A') RETURNING id`,
      [companyAId],
    );
    const roleId = role.rows[0].id;

    await expect(
      client.query(
        `INSERT INTO user_roles (user_id, company_id, role_id) VALUES ($1, $2, $3)`,
        [userId, companyBId, roleId],
      ),
    ).rejects.toThrow(/does not belong to company/);
  });

  it("rejects a chart of accounts parent from a different company", async () => {
    const parent = await client.query(
      `INSERT INTO chart_of_accounts (company_id, account_code, name_en, name_ar, account_type, normal_balance, is_header)
       VALUES ($1, 'P1', 'Parent', 'أب', 'asset', 'debit', true) RETURNING id`,
      [companyAId],
    );
    const parentId = parent.rows[0].id;

    await expect(
      client.query(
        `INSERT INTO chart_of_accounts (company_id, parent_id, account_code, name_en, name_ar, account_type, normal_balance)
         VALUES ($1, $2, 'C1', 'Child', 'ابن', 'asset', 'debit')`,
        [companyBId, parentId],
      ),
    ).rejects.toThrow(/does not belong to company/);
  });

  it("rejects a fiscal period whose dates fall outside its fiscal year", async () => {
    const fy = await client.query(
      `INSERT INTO fiscal_years (company_id, year_name, start_date, end_date)
       VALUES ($1, 'FYX', '2026-01-01', '2026-12-31') RETURNING id`,
      [companyAId],
    );
    const fyId = fy.rows[0].id;

    await expect(
      client.query(
        `INSERT INTO fiscal_periods (fiscal_year_id, company_id, period_number, start_date, end_date)
         VALUES ($1, $2, 1, '2025-12-15', '2026-01-15')`,
        [fyId, companyAId],
      ),
    ).rejects.toThrow(/outside fiscal year/);
  });
});

describe("uniqueness", () => {
  it("rejects duplicate company_code", async () => {
    await expect(
      client.query(
        `INSERT INTO companies (company_code, name_en, name_ar) SELECT company_code, 'dup', 'مكرر' FROM companies WHERE id = $1`,
        [companyAId],
      ),
    ).rejects.toThrow();
  });

  it("allows the same branch_code in two different companies", async () => {
    const a = await client.query(
      `INSERT INTO branches (company_id, branch_code, name_en, name_ar) VALUES ($1, 'HQ', 'HQ A', 'المقر أ') RETURNING id`,
      [companyAId],
    );
    const b = await client.query(
      `INSERT INTO branches (company_id, branch_code, name_en, name_ar) VALUES ($1, 'HQ', 'HQ B', 'المقر ب') RETURNING id`,
      [companyBId],
    );
    expect(a.rows[0].id).not.toEqual(b.rows[0].id);
  });
});

describe("number sequences", () => {
  it("is gap-free and unique under concurrent callers", async () => {
    const clients = await Promise.all(Array.from({ length: 20 }, () => newClient()));
    await Promise.all(clients.map((c) => c.connect()));

    try {
      const results = await Promise.all(
        clients.map((c) =>
          c.query<{ fn_next_document_number: string }>(
            `SELECT fn_next_document_number($1, 'test_doc', 2026, 'T-') AS fn_next_document_number`,
            [companyAId],
          ),
        ),
      );

      const numbers = results.map((r) => r.rows[0]!.fn_next_document_number);
      const uniqueNumbers = new Set(numbers);
      expect(uniqueNumbers.size).toBe(20);

      const sequenceValues = numbers
        .map((n) => parseInt(n.split("-").pop()!, 10))
        .sort((a, b) => a - b);
      expect(sequenceValues).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});

describe("audit log", () => {
  it("records an INSERT and an UPDATE with before/after snapshots", async () => {
    const insertResult = await client.query(
      `INSERT INTO branches (company_id, branch_code, name_en, name_ar) VALUES ($1, 'AUD', 'Audit Branch', 'فرع التدقيق') RETURNING id`,
      [companyAId],
    );
    const branchId = insertResult.rows[0].id;

    await client.query(`UPDATE branches SET name_en = 'Audit Branch Renamed' WHERE id = $1`, [branchId]);

    const logs = await client.query(
      `SELECT action, before, after FROM audit_log WHERE table_name = 'branches' AND row_id = $1 ORDER BY occurred_at`,
      [branchId],
    );

    expect(logs.rows.length).toBe(2);
    expect(logs.rows[0].action).toBe("INSERT");
    expect(logs.rows[0].before).toBeNull();
    expect(logs.rows[0].after.name_en).toBe("Audit Branch");

    expect(logs.rows[1].action).toBe("UPDATE");
    expect(logs.rows[1].before.name_en).toBe("Audit Branch");
    expect(logs.rows[1].after.name_en).toBe("Audit Branch Renamed");
  });
});
