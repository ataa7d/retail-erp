import { describe, expect, it } from "vitest";
import { buildZatcaQrPayload, renderZatcaQrDataUrl } from "../src/zatca/qrCode.js";

/** Decodes a ZATCA TLV Base64 payload back into its five fields, for round-trip assertions. */
function decodeTlv(base64: string): Record<number, string> {
  const buf = Buffer.from(base64, "base64");
  const out: Record<number, string> = {};
  let i = 0;
  while (i < buf.length) {
    const tag = buf[i]!;
    const len = buf[i + 1]!;
    const value = buf.subarray(i + 2, i + 2 + len).toString("utf8");
    out[tag] = value;
    i += 2 + len;
  }
  return out;
}

describe("ZATCA QR TLV payload", () => {
  const fields = {
    sellerName: "Demo Retail Group",
    vatRegistrationNumber: "300000000000003",
    timestamp: "2026-09-24T12:34:56.000Z",
    invoiceTotal: 1150.5,
    vatTotal: 150.07,
  };

  it("round-trips all five fields exactly", () => {
    const payload = buildZatcaQrPayload(fields);
    const decoded = decodeTlv(payload);
    expect(decoded[1]).toBe(fields.sellerName);
    expect(decoded[2]).toBe(fields.vatRegistrationNumber);
    expect(decoded[3]).toBe(fields.timestamp);
    expect(decoded[4]).toBe("1150.50");
    expect(decoded[5]).toBe("150.07");
  });

  it("is deterministic for the same inputs", () => {
    expect(buildZatcaQrPayload(fields)).toBe(buildZatcaQrPayload(fields));
  });

  it("rejects a VAT number that isn't exactly 15 digits", () => {
    expect(() => buildZatcaQrPayload({ ...fields, vatRegistrationNumber: "12345" })).toThrow(/15-digit/);
    expect(() => buildZatcaQrPayload({ ...fields, vatRegistrationNumber: "" })).toThrow(/15-digit/);
  });

  it("rejects an empty seller name", () => {
    expect(() => buildZatcaQrPayload({ ...fields, sellerName: "  " })).toThrow(/seller name/);
  });

  it("handles a seller name with Arabic/UTF-8 characters by byte length, not character count", () => {
    const arabicFields = { ...fields, sellerName: "مجموعة ديمو للتجزئة" };
    const payload = buildZatcaQrPayload(arabicFields);
    const decoded = decodeTlv(payload);
    expect(decoded[1]).toBe(arabicFields.sellerName);
  });

  it("renders a scannable PNG data URL", async () => {
    const dataUrl = await renderZatcaQrDataUrl(fields);
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
