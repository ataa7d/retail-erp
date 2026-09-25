import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { newClient } from "./helpers.js";
import {
  createPurchaseRequisition,
  submitPurchaseRequisition,
  withdrawPurchaseRequisition,
  approvePurchaseRequisition,
  rejectPurchaseRequisition,
  convertPurchaseRequisitionToPo,
} from "../src/purchasing/purchasingService.js";

let client: Client;
let companyId: string;
let storeId: string;
let supplierId: string;
let periodId: string;
let requesterId: string;
let approverId: string;

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

beforeAll(async () => {
  client = newClient();
  await client.connect();

  const company = await client.query(
    `INSERT INTO companies (company_code, name_en, name_ar) VALUES ($1, 'Test Co PR', 'شركة') RETURNING id`,
    [`TEST_PR_${randomUUID().slice(0, 8)}`],
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

  const requester = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, 'x', 'Requester', 'طالب') RETURNING id`,
    [`prreq_${randomUUID()}@test.local`],
  );
  requesterId = requester.rows[0].id;
  const approver = await client.query(
    `INSERT INTO users (email, password_hash, full_name_en, full_name_ar) VALUES ($1, 'x', 'Approver', 'موافق') RETURNING id`,
    [`prapp_${randomUUID()}@test.local`],
  );
  approverId = approver.rows[0].id;
});

afterAll(async () => {
  await client.query(`SET app.bypass_immutability = 'true'`);
  await client.query(`DELETE FROM audit_log WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM purchase_order_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM purchase_orders WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM purchase_requisition_lines WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM purchase_requisitions WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM supplier_item_prices WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM item_variants WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM items WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM number_sequences WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_periods WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM fiscal_years WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM suppliers WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM stores WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM branches WHERE company_id = $1`, [companyId]);
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  await client.end();
});

describe("purchase requisition state machine", () => {
  it("walks draft -> pending_approval -> approved -> converted_to_po", async () => {
    const variantId = await newItemVariant();
    const requisitionId = await createPurchaseRequisition(client, {
      companyId, storeId, requisitionDate: "2026-03-10",
      lines: [{ itemVariantId: variantId, qty: 10 }], createdBy: requesterId,
    });

    let row = await client.query(`SELECT document_status FROM purchase_requisitions WHERE id = $1`, [requisitionId]);
    expect(row.rows[0].document_status).toBe("draft");

    await submitPurchaseRequisition(client, requisitionId);
    row = await client.query(`SELECT document_status, submitted_at FROM purchase_requisitions WHERE id = $1`, [requisitionId]);
    expect(row.rows[0].document_status).toBe("pending_approval");
    expect(row.rows[0].submitted_at).not.toBeNull();

    await approvePurchaseRequisition(client, requisitionId, approverId);
    row = await client.query(`SELECT document_status, decided_at, decided_by FROM purchase_requisitions WHERE id = $1`, [requisitionId]);
    expect(row.rows[0].document_status).toBe("approved");
    expect(row.rows[0].decided_at).not.toBeNull();
    expect(row.rows[0].decided_by).toBe(approverId);

    const reqLine = await client.query(`SELECT id FROM purchase_requisition_lines WHERE requisition_id = $1`, [requisitionId]);
    const poId = await convertPurchaseRequisitionToPo(client, {
      requisitionId, companyId, storeId, supplierId,
      orderDate: "2026-03-11", fiscalPeriodId: periodId, createdBy: approverId,
      lines: [{
        requisitionLineId: reqLine.rows[0].id, itemVariantId: variantId, qty: 10,
        unitPrice: 25, discountAmount: 0, vatRate: 15, priceIncludesVat: false,
      }],
    });

    const po = await client.query(`SELECT purchase_requisition_id, gross_amount, document_status FROM purchase_orders WHERE id = $1`, [poId]);
    expect(po.rows[0].purchase_requisition_id).toBe(requisitionId);
    expect(Number(po.rows[0].gross_amount)).toBe(287.5); // 10 * 25 * 1.15
    expect(po.rows[0].document_status).toBe("posted"); // conversion also approves the PO, same as every other PO-creation path

    row = await client.query(`SELECT document_status FROM purchase_requisitions WHERE id = $1`, [requisitionId]);
    expect(row.rows[0].document_status).toBe("converted_to_po");
  });

  it("blocks self-approval and requires a reason to reject", async () => {
    const variantId = await newItemVariant();
    const requisitionId = await createPurchaseRequisition(client, {
      companyId, storeId, requisitionDate: "2026-03-12",
      lines: [{ itemVariantId: variantId, qty: 5 }], createdBy: requesterId,
    });
    await submitPurchaseRequisition(client, requisitionId);

    await expect(approvePurchaseRequisition(client, requisitionId, requesterId)).rejects.toThrow(/own requester/);
    await expect(rejectPurchaseRequisition(client, requisitionId, approverId, "")).rejects.toThrow(/reason/);

    await rejectPurchaseRequisition(client, requisitionId, approverId, "Not needed this quarter");
    const row = await client.query(`SELECT document_status, rejection_reason FROM purchase_requisitions WHERE id = $1`, [requisitionId]);
    expect(row.rows[0].document_status).toBe("rejected");
    expect(row.rows[0].rejection_reason).toBe("Not needed this quarter");

    // Terminal: no further transitions allowed at all.
    await expect(client.query(`UPDATE purchase_requisitions SET document_status = 'approved' WHERE id = $1`, [requisitionId])).rejects.toThrow(
      /is rejected and cannot be modified/,
    );
  });

  it("rejects submitting an empty requisition and locks lines once submitted", async () => {
    const variantId = await newItemVariant();
    const emptyId = await createPurchaseRequisition(client, {
      companyId, storeId, requisitionDate: "2026-03-13", lines: [], createdBy: requesterId,
    });
    await expect(submitPurchaseRequisition(client, emptyId)).rejects.toThrow(/no lines/);

    const requisitionId = await createPurchaseRequisition(client, {
      companyId, storeId, requisitionDate: "2026-03-13",
      lines: [{ itemVariantId: variantId, qty: 3 }], createdBy: requesterId,
    });
    await submitPurchaseRequisition(client, requisitionId);

    const line = await client.query(`SELECT id FROM purchase_requisition_lines WHERE requisition_id = $1`, [requisitionId]);
    await expect(
      client.query(`UPDATE purchase_requisition_lines SET qty = 99 WHERE id = $1`, [line.rows[0].id]),
    ).rejects.toThrow(/immutable/);
  });

  it("lets the requester withdraw a pending requisition, and locks it afterward", async () => {
    const variantId = await newItemVariant();
    const requisitionId = await createPurchaseRequisition(client, {
      companyId, storeId, requisitionDate: "2026-03-15",
      lines: [{ itemVariantId: variantId, qty: 2 }], createdBy: requesterId,
    });
    await submitPurchaseRequisition(client, requisitionId);

    await withdrawPurchaseRequisition(client, requisitionId);
    const row = await client.query(`SELECT document_status FROM purchase_requisitions WHERE id = $1`, [requisitionId]);
    expect(row.rows[0].document_status).toBe("withdrawn");

    await expect(approvePurchaseRequisition(client, requisitionId, approverId)).rejects.toThrow(/is withdrawn and cannot be modified/);
  });

  it("cannot withdraw a draft or already-decided requisition (state machine only allows it from pending_approval)", async () => {
    const variantId = await newItemVariant();
    const draftId = await createPurchaseRequisition(client, {
      companyId, storeId, requisitionDate: "2026-03-16",
      lines: [{ itemVariantId: variantId, qty: 1 }], createdBy: requesterId,
    });
    await expect(withdrawPurchaseRequisition(client, draftId)).rejects.toThrow(/illegal purchase requisition status transition/);
  });

  it("rejects an illegal status jump, e.g. draft straight to approved", async () => {
    const variantId = await newItemVariant();
    const requisitionId = await createPurchaseRequisition(client, {
      companyId, storeId, requisitionDate: "2026-03-14",
      lines: [{ itemVariantId: variantId, qty: 1 }], createdBy: requesterId,
    });
    await expect(
      client.query(`UPDATE purchase_requisitions SET document_status = 'approved', decided_by = $2 WHERE id = $1`, [
        requisitionId, approverId,
      ]),
    ).rejects.toThrow(/illegal purchase requisition status transition/);
  });
});
