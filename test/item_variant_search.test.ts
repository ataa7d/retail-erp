import "dotenv/config";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Client } from "pg";
import { newClient } from "./helpers.js";
import { buildApp } from "../src/api/app.js";

let app: FastifyInstance;
let client: Client;
let companyId: string;
let brandId: string;
let authToken: string;

const PASSWORD = "TestPass123!";

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  client = newClient();
  await client.connect();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co VarSearch', 'شركة') RETURNING id`,
    [`TEST_VS_${randomUUID().slice(0, 8)}`],
  );
  companyId = company.rows[0].id;

  const brand = await client.query(`INSERT INTO brands (company_id, code, name_en, name_ar) VALUES ($1, 'NIKE', 'Nike', 'نايك') RETURNING id`, [
    companyId,
  ]);
  brandId = brand.rows[0].id;
  await client.query(`INSERT INTO brands (company_id, code, name_en, name_ar) VALUES ($1, 'GEN', 'Generic', 'عام')`, [companyId]);

  // 25 variants across 5 items, so pagination (pageSize 10) and filters have something real to work against.
  for (let i = 1; i <= 5; i++) {
    const item = await client.query(
      `INSERT INTO items (company_id, item_code, name_en, name_ar, brand_id) VALUES ($1, $2, $3, 'صنف', $4) RETURNING id`,
      [companyId, `SEARCH-${i}`, `Search Item ${i}`, i <= 2 ? brandId : null],
    );
    for (let v = 1; v <= 5; v++) {
      await client.query(
        `INSERT INTO item_variants (company_id, item_id, variant_code, color, is_active) VALUES ($1, $2, $3, $4, $5)`,
        [companyId, item.rows[0].id, `SEARCH-${i}-V${v}`, v === 1 ? "Red" : "Blue", !(i === 5 && v === 5)],
      );
    }
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Search Test User', 'مستخدم') RETURNING id`,
    [`varsearch_${randomUUID()}@test.local`, passwordHash],
  );
  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [user.rows[0].id, companyId]);
  const userEmail = (await client.query(`SELECT email FROM users WHERE id = $1`, [user.rows[0].id])).rows[0].email;

  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: userEmail, password: PASSWORD } });
  authToken = loginRes.json().token;
});

afterAll(async () => {
  await app.close();
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_variants WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM items WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE email LIKE 'varsearch_%'`);
  await client.query(`DELETE FROM brands WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

function get(query: string) {
  return app.inject({
    method: "GET",
    url: `/api/item-variants?${query}`,
    headers: { Authorization: `Bearer ${authToken}`, "X-Company-Id": companyId },
  });
}

describe("GET /item-variants", () => {
  it("paginates: reports the true total across all pages, not just the page returned", async () => {
    const res = await get("pageSize=10&page=1");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows).toHaveLength(10);
    expect(body.total).toBe(25);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(10);
  });

  it("returns a different, non-overlapping slice on page 2", async () => {
    const page1 = (await get("pageSize=10&page=1&sortBy=variantCode")).json();
    const page2 = (await get("pageSize=10&page=2&sortBy=variantCode")).json();
    const page1Codes = new Set(page1.rows.map((r: { variant_code: string }) => r.variant_code));
    const page2Codes = page2.rows.map((r: { variant_code: string }) => r.variant_code);
    for (const code of page2Codes) expect(page1Codes.has(code)).toBe(false);
  });

  it("filters by free-text search across item code, name, and variant code", async () => {
    const res = await get("search=SEARCH-3");
    const body = res.json();
    expect(body.total).toBe(5); // all 5 variants of item SEARCH-3
    expect(body.rows.every((r: { item_code: string }) => r.item_code === "SEARCH-3")).toBe(true);
  });

  it("filters by exact brand and by color substring, combinable", async () => {
    const res = await get(`brandId=${brandId}&color=Red`);
    const body = res.json();
    // brand only set on items 1-2, and only variant V1 of each has color Red.
    expect(body.total).toBe(2);
  });

  it("filters by active status", async () => {
    const res = await get("isActive=false");
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.rows[0].variant_code).toBe("SEARCH-5-V5");
  });

  it("sorts descending", async () => {
    const res = await get("sortBy=variantCode&sortDir=desc&pageSize=1");
    const body = res.json();
    expect(body.rows[0].variant_code).toBe("SEARCH-5-V5");
  });

  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/api/item-variants" });
    expect(res.statusCode).toBe(401);
  });
});
