/**
 * POS device registration. A device's series_prefix is chosen by whoever
 * registers it (an admin, per sales.pos_device.manage) and is permanent
 * from that point on — see the immutability trigger in
 * migrations/0043_pos_devices_and_sync.sql. Registration also seeds the
 * device's two sequence counters (pos_invoice, credit_note) at zero, so the
 * first document it syncs must be device_sequence_number = 1.
 */

import type { Client } from "pg";

export interface RegisterPosDeviceParams {
  companyId: string;
  storeId: string;
  deviceCode: string;
  deviceName: string;
  seriesPrefix: string;
  createdBy: string | null;
}

export async function registerPosDevice(client: Client, params: RegisterPosDeviceParams): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO pos_devices (company_id, store_id, device_code, device_name, series_prefix, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [params.companyId, params.storeId, params.deviceCode, params.deviceName, params.seriesPrefix, params.createdBy],
  );
  const deviceId = result.rows[0]!.id;

  await client.query(
    `INSERT INTO pos_device_sequences (device_id, document_type) VALUES ($1, 'pos_invoice'), ($1, 'credit_note')`,
    [deviceId],
  );

  return deviceId;
}

export async function retirePosDevice(client: Client, deviceId: string): Promise<void> {
  await client.query(`UPDATE pos_devices SET status = 'retired', retired_at = now() WHERE id = $1`, [deviceId]);
}
