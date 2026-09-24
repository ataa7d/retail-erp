/**
 * ZATCA Phase 1 (Generation phase) e-invoicing: the mandatory Base64 TLV
 * QR code carried on every tax invoice and credit/debit note, standard or
 * simplified. This is the whole Phase 1 requirement -- Phase 2 (Integration
 * phase: XML invoices, digital signing with a ZATCA-issued CSID, and
 * clearance/reporting through ZATCA's API) is a separate, credential-bound
 * project against a real ZATCA account and is out of scope here.
 *
 * TLV = Tag-Length-Value. Five fields, each tag/length/value concatenated
 * byte-for-byte, per ZATCA's published spec:
 *   1  Seller name              UTF-8
 *   2  VAT registration number  UTF-8, 15 digits
 *   3  Invoice timestamp        UTF-8, ISO 8601
 *   4  Invoice total (with VAT) UTF-8, 2 decimal places
 *   5  VAT total                UTF-8, 2 decimal places
 * The whole buffer is then Base64-encoded -- that string is what a POS
 * receipt or invoice PDF encodes into the actual QR image.
 */

import QRCode from "qrcode";

export interface ZatcaQrFields {
  sellerName: string;
  vatRegistrationNumber: string;
  /** ISO 8601 timestamp of the invoice/credit note. */
  timestamp: string;
  /** Total including VAT. */
  invoiceTotal: number;
  vatTotal: number;
}

function tlvField(tag: number, value: string): Buffer {
  const valueBuf = Buffer.from(value, "utf8");
  if (valueBuf.length > 255) {
    throw new Error(`ZATCA QR field ${tag} exceeds the 255-byte TLV length limit`);
  }
  return Buffer.concat([Buffer.from([tag, valueBuf.length]), valueBuf]);
}

/** The Base64 TLV string -- this is the exact string a scanning app decodes back into the five fields above. */
export function buildZatcaQrPayload(fields: ZatcaQrFields): string {
  if (!fields.sellerName.trim()) throw new Error("ZATCA QR requires a seller name");
  if (!/^\d{15}$/.test(fields.vatRegistrationNumber)) {
    throw new Error(`ZATCA QR requires a 15-digit VAT registration number, got "${fields.vatRegistrationNumber}"`);
  }

  const buf = Buffer.concat([
    tlvField(1, fields.sellerName),
    tlvField(2, fields.vatRegistrationNumber),
    tlvField(3, fields.timestamp),
    tlvField(4, fields.invoiceTotal.toFixed(2)),
    tlvField(5, fields.vatTotal.toFixed(2)),
  ]);
  return buf.toString("base64");
}

/** Renders the TLV payload as a scannable PNG data URL for embedding directly in an <img> tag. */
export async function renderZatcaQrDataUrl(fields: ZatcaQrFields): Promise<string> {
  const payload = buildZatcaQrPayload(fields);
  return QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 1, width: 220 });
}
