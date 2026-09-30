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
let authToken: string;

const PASSWORD = "TestPass123!";

beforeAll(async () => {
  client = newClient();
  await client.connect();
  app = await buildApp();
  await app.ready();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co Bulk Route', 'شركة') RETURNING id`,
    [`TEST_BULKRT_${randomUUID().slice(0, 8)}`],
  );
  companyId = company.rows[0].id;

  await client.query(
    `INSERT INTO units_of_measure (company_id, code, name_en, name_ar) VALUES ($1, 'PC', 'Piece', 'قطعة')`,
    [companyId],
  );

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Bulk Route User', 'مستخدم') RETURNING id, email`,
    [`bulkrouteuser_${randomUUID()}@test.local`, passwordHash],
  );
  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [user.rows[0].id, companyId]);
  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Inventory') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = 'inventory.items.manage'`,
    [role.rows[0].id],
  );
  await client.query(`INSERT INTO user_roles (user_id, company_id, role_id) VALUES ($1, $2, $3)`, [user.rows[0].id, companyId, role.rows[0].id]);

  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: user.rows[0].email, password: PASSWORD } });
  authToken = loginRes.json().token;
});

afterAll(async () => {
  await app.close();
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_barcodes WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_units WHERE item_id IN (SELECT id FROM items WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM item_variants WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM items WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE email LIKE 'bulkrouteuser_%'`);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM units_of_measure WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("POST /items/bulk-import", () => {
  it("returns a variantId per created row, usable to add the item straight into a document (e.g. a PO line)", async () => {
    const csv = [
      "item_code,name_en,name_ar,base_unit_code,variant_code,standard_cost",
      "RT-BULK-1,Route Bulk Item,صنف تجريبي,PC,RT-BULK-1-V1,12.50",
    ].join("\n");

    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), "import.csv");

    const res = await app.inject({
      method: "POST",
      url: "/api/items/bulk-import",
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: form,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(1);
    expect(body.results[0].status).toBe("created");
    expect(body.results[0].variantId).toBeTruthy();

    const row = await client.query(`SELECT id FROM item_variants WHERE id = $1`, [body.results[0].variantId]);
    expect(row.rows).toHaveLength(1);
  });
});
