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
let supplierId: string;
let authToken: string;

const PASSWORD = "TestPass123!";

beforeAll(async () => {
  client = newClient();
  await client.connect();
  app = await buildApp();
  await app.ready();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co Supplier Routes', 'شركة') RETURNING id`,
    [`TEST_SUPRT_${randomUUID().slice(0, 8)}`],
  );
  companyId = company.rows[0].id;

  const supplier = await client.query(
    `INSERT INTO suppliers (company_id, supplier_code, name_en, name_ar, currency, payment_terms_days)
     VALUES ($1, 'SUP-RT-1', 'Original Name', 'اسم أصلي', 'SAR', 30) RETURNING id`,
    [companyId],
  );
  supplierId = supplier.rows[0].id;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Supplier Route User', 'مستخدم') RETURNING id, email`,
    [`supplierrouteuser_${randomUUID()}@test.local`, passwordHash],
  );
  await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [user.rows[0].id, companyId]);
  const role = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Purchasing') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = 'purchasing.supplier.manage'`,
    [role.rows[0].id],
  );
  await client.query(`INSERT INTO user_roles (user_id, company_id, role_id) VALUES ($1, $2, $3)`, [user.rows[0].id, companyId, role.rows[0].id]);

  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: user.rows[0].email, password: PASSWORD } });
  authToken = loginRes.json().token;
});

afterAll(async () => {
  await app.close();
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM suppliers WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM users WHERE email LIKE 'supplierrouteuser_%'`);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("POST /suppliers/:id", () => {
  it("updates commercial details without changing code or currency", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/suppliers/${supplierId}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: {
        nameEn: "Renamed Supplier",
        nameAr: "مورد معاد تسميته",
        crNumber: "1234567890",
        vatRegistrationNumber: "300999888777666",
        phone: "+966500000000",
        paymentTermsDays: 45,
      },
    });
    expect(res.statusCode).toBe(200);

    const row = await client.query(
      `SELECT supplier_code, currency, name_en, cr_number, phone, payment_terms_days FROM suppliers WHERE id = $1`,
      [supplierId],
    );
    expect(row.rows[0].supplier_code).toBe("SUP-RT-1");
    expect(row.rows[0].currency).toBe("SAR");
    expect(row.rows[0].name_en).toBe("Renamed Supplier");
    expect(row.rows[0].cr_number).toBe("1234567890");
    expect(row.rows[0].phone).toBe("+966500000000");
    expect(row.rows[0].payment_terms_days).toBe(45);
  });

  it("404s for a supplier from another company", async () => {
    const otherCompany = await client.query(
      `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Other', 'x') RETURNING id`,
      [`TEST_SUPRT_OTHER_${randomUUID().slice(0, 8)}`],
    );
    const otherSupplier = await client.query(
      `INSERT INTO suppliers (company_id, supplier_code, name_en, name_ar) VALUES ($1, 'X1', 'x', 'x') RETURNING id`,
      [otherCompany.rows[0].id],
    );
    const res = await app.inject({
      method: "POST",
      url: `/api/suppliers/${otherSupplier.rows[0].id}`,
      headers: { authorization: `Bearer ${authToken}`, "x-company-id": companyId },
      payload: { nameEn: "Hacked", nameAr: "x", paymentTermsDays: 0 },
    });
    expect(res.statusCode).toBe(404);

    await client.query(`DELETE FROM suppliers WHERE company_id = $1`, [otherCompany.rows[0].id]);
    await client.query(`DELETE FROM companies WHERE id = $1`, [otherCompany.rows[0].id]);
  });
});
