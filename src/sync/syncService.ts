/**
 * Offline POS sync: turns a device's locally-numbered draft document into a
 * real, posted one, exactly once, no matter how many times the device
 * retries the sync call.
 *
 * Two guarantees this file exists to provide, on top of what
 * src/sales/salesService.ts already enforces:
 *
 * 1. Idempotency — a device may retry a sync call (dropped connection,
 *    ambiguous response) freely. We key on the device's own client_uuid: if
 *    that document has already synced, we return the existing id and do
 *    nothing else, rather than erroring or creating a duplicate.
 *
 * 2. Sequence integrity — the device already assigned itself a permanent
 *    document number (device_sequence_number) while offline; we never
 *    generate one here. What we DO enforce is that the number the device
 *    claims is exactly pos_device_sequences.last_synced_seq + 1: a gap
 *    (device skipped a number) or a replay out of order (an earlier
 *    unsynced document arriving after a later one already did) is rejected
 *    with a clear error rather than silently accepted, per the design
 *    discussed for Phase 8. This does mean a device must sync its own
 *    documents in the order it created them — a documented constraint, not
 *    an oversight.
 */

import type { Client } from "pg";
import {
  createSalesInvoice,
  postSalesInvoice,
  createCreditNote,
  postCreditNote,
  type SalesInvoiceLineRequest,
  type CreditNoteLineRequest,
} from "../sales/salesService.js";

export interface SyncResult {
  id: string;
  alreadySynced: boolean;
}

interface DeviceRow {
  id: string;
  store_id: string;
  series_prefix: string;
  status: string;
}

async function getActiveDevice(client: Client, companyId: string, deviceId: string): Promise<DeviceRow> {
  // FOR UPDATE: two concurrent sync calls for the same device must not both
  // read the same last_synced_seq and both think they're "next".
  const result = await client.query<DeviceRow>(
    `SELECT id, store_id, series_prefix, status FROM pos_devices WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [deviceId, companyId],
  );
  if (result.rows.length === 0) {
    throw new Error(`pos device ${deviceId} not found`);
  }
  if (result.rows[0]!.status !== "active") {
    throw new Error(`pos device ${deviceId} is retired and cannot sync new documents`);
  }
  return result.rows[0]!;
}

async function claimDeviceSequenceNumber(
  client: Client,
  deviceId: string,
  documentType: "pos_invoice" | "credit_note",
  claimedSeq: number,
): Promise<void> {
  const result = await client.query<{ last_synced_seq: string }>(
    `SELECT last_synced_seq FROM pos_device_sequences WHERE device_id = $1 AND document_type = $2 FOR UPDATE`,
    [deviceId, documentType],
  );
  if (result.rows.length === 0) {
    throw new Error(`device ${deviceId} has no ${documentType} sequence registered`);
  }
  const expected = Number(result.rows[0]!.last_synced_seq) + 1;
  if (claimedSeq !== expected) {
    throw new Error(
      `device ${deviceId} ${documentType} sequence out of order: expected ${expected}, got ${claimedSeq}`,
    );
  }
  await client.query(
    `UPDATE pos_device_sequences SET last_synced_seq = $3, updated_at = now() WHERE device_id = $1 AND document_type = $2`,
    [deviceId, documentType, claimedSeq],
  );
}

export interface SyncPosInvoiceParams {
  companyId: string;
  deviceId: string;
  clientUuid: string;
  deviceSequenceNumber: number;
  storeId: string;
  zatcaInvoiceCategory: "simplified" | "standard";
  invoiceDate: string;
  fiscalPeriodId: string;
  customerId: string | null;
  salespersonId: string | null;
  priceListId: string | null;
  createdBy: string;
  lines: SalesInvoiceLineRequest[];
  payments?: Array<{ paymentMethod: "cash" | "card" | "credit" | "points" | "gift_card"; amount: number; reference?: string }>;
}

export async function syncPosInvoice(client: Client, params: SyncPosInvoiceParams): Promise<SyncResult> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM sales_invoices WHERE company_id = $1 AND client_uuid = $2`,
    [params.companyId, params.clientUuid],
  );
  if (existing.rows.length > 0) {
    return { id: existing.rows[0]!.id, alreadySynced: true };
  }

  const device = await getActiveDevice(client, params.companyId, params.deviceId);
  if (device.store_id !== params.storeId) {
    throw new Error(`device ${params.deviceId} is registered to a different store than ${params.storeId}`);
  }
  await claimDeviceSequenceNumber(client, params.deviceId, "pos_invoice", params.deviceSequenceNumber);

  const documentNumber = `${device.series_prefix}INV-${String(params.deviceSequenceNumber).padStart(6, "0")}`;

  const invoiceId = await createSalesInvoice(client, {
    companyId: params.companyId,
    storeId: params.storeId,
    invoiceChannel: "pos",
    zatcaInvoiceCategory: params.zatcaInvoiceCategory,
    invoiceDate: params.invoiceDate,
    fiscalPeriodId: params.fiscalPeriodId,
    customerId: params.customerId,
    salespersonId: params.salespersonId,
    priceListId: params.priceListId,
    createdBy: params.createdBy,
    lines: params.lines,
    payments: params.payments,
    documentNumberOverride: documentNumber,
    issuedByDeviceId: params.deviceId,
    deviceSequenceNumber: params.deviceSequenceNumber,
    clientUuid: params.clientUuid,
  });
  await postSalesInvoice(client, invoiceId, params.createdBy);

  return { id: invoiceId, alreadySynced: false };
}

export interface SyncCreditNoteParams {
  companyId: string;
  deviceId: string;
  clientUuid: string;
  deviceSequenceNumber: number;
  storeId: string;
  originalInvoiceId: string;
  zatcaInvoiceCategory: "simplified" | "standard";
  creditNoteDate: string;
  fiscalPeriodId: string;
  customerId: string | null;
  reason: string;
  createdBy: string;
  lines: CreditNoteLineRequest[];
}

export async function syncPosCreditNote(client: Client, params: SyncCreditNoteParams): Promise<SyncResult> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM credit_notes WHERE company_id = $1 AND client_uuid = $2`,
    [params.companyId, params.clientUuid],
  );
  if (existing.rows.length > 0) {
    return { id: existing.rows[0]!.id, alreadySynced: true };
  }

  const device = await getActiveDevice(client, params.companyId, params.deviceId);
  if (device.store_id !== params.storeId) {
    throw new Error(`device ${params.deviceId} is registered to a different store than ${params.storeId}`);
  }
  await claimDeviceSequenceNumber(client, params.deviceId, "credit_note", params.deviceSequenceNumber);

  const documentNumber = `${device.series_prefix}CN-${String(params.deviceSequenceNumber).padStart(6, "0")}`;

  const creditNoteId = await createCreditNote(client, {
    companyId: params.companyId,
    storeId: params.storeId,
    originalInvoiceId: params.originalInvoiceId,
    zatcaInvoiceCategory: params.zatcaInvoiceCategory,
    creditNoteDate: params.creditNoteDate,
    fiscalPeriodId: params.fiscalPeriodId,
    customerId: params.customerId,
    reason: params.reason,
    createdBy: params.createdBy,
    lines: params.lines,
    documentNumberOverride: documentNumber,
    issuedByDeviceId: params.deviceId,
    deviceSequenceNumber: params.deviceSequenceNumber,
    clientUuid: params.clientUuid,
  });
  await postCreditNote(client, creditNoteId, params.createdBy);

  return { id: creditNoteId, alreadySynced: false };
}
