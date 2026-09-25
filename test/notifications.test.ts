import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Client } from "pg";
import { newClient } from "./helpers.js";
import { buildApp } from "../src/api/app.js";
import { createPurchaseRequisition, submitPurchaseRequisition } from "../src/purchasing/purchasingService.js";
import { recordStockMovement } from "../src/inventory/inventoryService.js";

let app: FastifyInstance;
let client: Client;
let companyId: string;
let storeId: string;
let requesterToken: string;
let approverToken: string;
let requesterId: string;
const PASSWORD = "TestPass123!";

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  client = newClient();
  await client.connect();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co Notif', 'شركة') RETURNING id`,
    [`TEST_NOTIF_${randomUUID().slice(0, 8)}`],
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

  const item = await client.query(
    `INSERT INTO items (company_id, item_code, name_en, name_ar) VALUES ($1, 'IT-LOW', 'Low Item', 'صنف') RETURNING id`,
    [companyId],
  );
  const variant = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code, reorder_point) VALUES ($1, $2, 'SKU-LOW', 10) RETURNING id`,
    [companyId, item.rows[0].id],
  );
  const lowStockVariantId = variant.rows[0].id;
  await recordStockMovement(client, {
    companyId, storeId, itemVariantId: lowStockVariantId, movementType: "receipt",
    qty: 3, explicitUnitCost: 5, sourceType: "test", createdBy: null,
  });

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const requester = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Requester', 'طالب') RETURNING id`,
    [`notifreq_${randomUUID()}@test.local`, passwordHash],
  );
  requesterId = requester.rows[0].id;
  const approver = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, $2, 'Approver', 'موافق') RETURNING id`,
    [`notifapp_${randomUUID()}@test.local`, passwordHash],
  );
  const approverId = approver.rows[0].id;

  for (const userId of [requesterId, approverId]) {
    await client.query(`INSERT INTO user_company_access (user_id, company_id) VALUES ($1, $2)`, [userId, companyId]);
  }
  const requesterRole = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Requester Role') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = 'purchasing.requisition.create'`,
    [requesterRole.rows[0].id],
  );
  await client.query(`INSERT INTO user_roles (user_id, company_id, role_id) VALUES ($1, $2, $3)`, [requesterId, companyId, requesterRole.rows[0].id]);

  const approverRole = await client.query(`INSERT INTO roles (company_id, name) VALUES ($1, 'Approver Role') RETURNING id`, [companyId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = 'purchasing.requisition.approve'`,
    [approverRole.rows[0].id],
  );
  await client.query(`INSERT INTO user_roles (user_id, company_id, role_id) VALUES ($1, $2, $3)`, [approverId, companyId, approverRole.rows[0].id]);

  const requesterEmail = requester.rows[0].email ?? (await client.query(`SELECT email FROM users WHERE id = $1`, [requesterId])).rows[0].email;
  const approverEmail = (await client.query(`SELECT email FROM users WHERE id = $1`, [approverId])).rows[0].email;

  requesterToken = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: requesterEmail, password: PASSWORD } })).json().token;
  approverToken = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: approverEmail, password: PASSWORD } })).json().token;

  const variantForReq = await client.query(
    `INSERT INTO item_variants (company_id, item_id, variant_code) VALUES ($1, $2, 'SKU-REQ') RETURNING id`,
    [companyId, item.rows[0].id],
  );
  const requisitionId = await createPurchaseRequisition(client, {
    companyId, storeId, requisitionDate: "2026-03-10",
    lines: [{ itemVariantId: variantForReq.rows[0].id, qty: 5 }], createdBy: requesterId,
  });
  await submitPurchaseRequisition(client, requisitionId);
});

afterAll(async () => {
  await app.close();
  await client.query(`SET app.bypass_immutability = 'true'`);
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM purchase_requisition_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM purchase_requisitions WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_movements WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stock_balances WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = $1)`, [companyId]);
  await client.query(`DELETE FROM roles WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM user_company_access WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_variants WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM items WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("GET /api/notifications", () => {
  it("shows low-stock items to a user with no approval rights, but no requisition notification", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { authorization: `Bearer ${requesterToken}`, "x-company-id": companyId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.some((i: { type: string }) => i.type === "low_stock")).toBe(true);
    expect(body.items.some((i: { type: string }) => i.type === "requisition_pending")).toBe(false);
  });

  it("shows the pending requisition to a user who can approve it", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { authorization: `Bearer ${approverToken}`, "x-company-id": companyId },
    });
    const body = res.json();
    const requisitionNotif = body.items.find((i: { type: string }) => i.type === "requisition_pending");
    expect(requisitionNotif).toBeTruthy();
    expect(requisitionNotif.link).toBe("/purchasing");
  });
});
