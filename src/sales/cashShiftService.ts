import type { Client, Pool } from "pg";
import { BusinessRuleError, NotFoundError } from "../api/errors.js";

type Queryable = Pool | Client;

export interface OpenCashShiftParams {
  companyId: string;
  storeId: string;
  deviceId: string;
  openingFloat: number;
  openedBy: string;
  openingNotes?: string | null;
}

export async function openCashShift(client: Client, p: OpenCashShiftParams): Promise<string> {
  const existing = await client.query(`SELECT id FROM cash_shifts WHERE device_id = $1 AND status = 'open'`, [p.deviceId]);
  if (existing.rows.length > 0) {
    throw new BusinessRuleError("this device already has an open cash shift; close it before opening another");
  }

  const result = await client.query<{ id: string }>(
    `INSERT INTO cash_shifts (company_id, store_id, device_id, opening_float, opened_by, opening_notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [p.companyId, p.storeId, p.deviceId, p.openingFloat, p.openedBy, p.openingNotes ?? null],
  );
  return result.rows[0]!.id;
}

export interface CloseCashShiftParams {
  shiftId: string;
  companyId: string;
  closingFloatCounted: number;
  closedBy: string;
  closingNotes?: string | null;
}

export async function closeCashShift(client: Client, p: CloseCashShiftParams): Promise<void> {
  const shift = await client.query(`SELECT id, status FROM cash_shifts WHERE id = $1 AND company_id = $2`, [p.shiftId, p.companyId]);
  if (shift.rows.length === 0) throw new NotFoundError("cash shift not found");
  if (shift.rows[0]!.status !== "open") throw new BusinessRuleError("cash shift is already closed");

  await client.query(
    `UPDATE cash_shifts
     SET status = 'closed', closing_float_counted = $2, closed_at = now(), closed_by = $3, closing_notes = $4
     WHERE id = $1`,
    [p.shiftId, p.closingFloatCounted, p.closedBy, p.closingNotes ?? null],
  );
}

export interface ZReportRow {
  payment_method: string;
  total: string;
  invoice_count: string;
}

export interface ZReport {
  shiftId: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
  openingFloat: string;
  closingFloatCounted: string | null;
  paymentTotals: ZReportRow[];
  cashSalesTotal: number;
  expectedCash: number;
  variance: number | null;
  grossSalesTotal: number;
  invoiceCount: number;
}

// Reconciles a shift's drawer: expected cash = opening float + cash sales
// taken during the shift window. Sales are matched to the shift purely by
// device_id + posted_at falling inside [opened_at, closed_at or now()] --
// there is no shift_id on sales_invoices, so an offline device that syncs
// later needs no knowledge of shifts at all; its invoices land in whichever
// shift window their posted_at (assigned at sync time) falls into.
export async function computeZReport(client: Queryable, companyId: string, shiftId: string): Promise<ZReport> {
  const shift = await client.query(
    `SELECT id, device_id, status, opening_float, opened_at, closing_float_counted, closed_at
     FROM cash_shifts WHERE id = $1 AND company_id = $2`,
    [shiftId, companyId],
  );
  if (shift.rows.length === 0) throw new NotFoundError("cash shift not found");
  const s = shift.rows[0]!;

  const payments = await client.query<ZReportRow>(
    `SELECT sip.payment_method, SUM(sip.amount) AS total, COUNT(DISTINCT sip.invoice_id) AS invoice_count
     FROM sales_invoice_payments sip
     JOIN sales_invoices si ON si.id = sip.invoice_id
     WHERE si.issued_by_device_id = $1
       AND si.document_status = 'posted'
       AND si.posted_at >= $2
       AND si.posted_at <= COALESCE($3, now())
     GROUP BY sip.payment_method
     ORDER BY sip.payment_method`,
    [s.device_id, s.opened_at, s.closed_at],
  );

  const cashSalesTotal = Number(payments.rows.find((r) => r.payment_method === "cash")?.total ?? 0);
  const expectedCash = Number(s.opening_float) + cashSalesTotal;
  const closingFloatCounted = s.closing_float_counted !== null ? Number(s.closing_float_counted) : null;

  const invoiceCountResult = await client.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM sales_invoices
     WHERE issued_by_device_id = $1 AND document_status = 'posted'
       AND posted_at >= $2 AND posted_at <= COALESCE($3, now())`,
    [s.device_id, s.opened_at, s.closed_at],
  );
  const grossTotalResult = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(gross_amount), 0) AS total FROM sales_invoices
     WHERE issued_by_device_id = $1 AND document_status = 'posted'
       AND posted_at >= $2 AND posted_at <= COALESCE($3, now())`,
    [s.device_id, s.opened_at, s.closed_at],
  );

  return {
    shiftId: s.id,
    status: s.status,
    openedAt: s.opened_at,
    closedAt: s.closed_at,
    openingFloat: s.opening_float,
    closingFloatCounted: s.closing_float_counted,
    paymentTotals: payments.rows,
    cashSalesTotal,
    expectedCash,
    variance: closingFloatCounted !== null ? Math.round((closingFloatCounted - expectedCash + Number.EPSILON) * 100) / 100 : null,
    grossSalesTotal: Number(grossTotalResult.rows[0]!.total),
    invoiceCount: Number(invoiceCountResult.rows[0]!.count),
  };
}
