import { beforeAll, describe, expect, it } from "vitest";
import forge from "node-forge";
import { generateZatcaCsr, csrPemToBase64, verifyZatcaCsrSignature } from "../src/zatca/csr.js";
import { encryptSecret, decryptSecret } from "../src/zatca/credentialCrypto.js";

const SUBJECT = { organizationName: "Demo Retail Group", organizationalUnitName: "Riyadh Flagship Branch", commonName: "POS-EGS-01" };
const SAN = {
  egsSerialNumber: "1-RetailERP|2-POS|3-0001",
  vatRegistrationNumber: "300000000000003",
  location: "Riyadh",
  industryBusinessCategory: "Retail",
  invoiceType: "1100",
};

describe("ZATCA CSR generation (offline, no network)", () => {
  it("produces a self-consistent, verifiable PKCS#10 CSR signed with a secp256k1 key", () => {
    const { privateKeyPem, publicKeyPem, csrPem } = generateZatcaCsr(SUBJECT, SAN);

    expect(privateKeyPem).toContain("-----BEGIN PRIVATE KEY-----");
    expect(publicKeyPem).toContain("-----BEGIN PUBLIC KEY-----");
    expect(csrPem).toContain("-----BEGIN CERTIFICATE REQUEST-----");

    // node-forge's own CSR reader is RSA-only (see the module doc comment
    // in src/zatca/csr.ts), so this verifies the ECDSA signature
    // independently instead of round-tripping through forge.
    expect(verifyZatcaCsrSignature(csrPem, publicKeyPem)).toBe(true);

    // Tampering with the DER content (not the PEM armor) must be rejected
    // -- either as a failed verification or a parse error -- otherwise the
    // check above would be vacuously true for any input. Flipping a
    // character near the end of the base64 body lands inside the
    // signature bytes themselves (the CSR's last ASN.1 element), so the
    // earlier structure still parses and the signature genuinely no
    // longer matches.
    const b64Body = csrPemToBase64(csrPem);
    const tailIndex = b64Body.length - 5;
    const flippedChar = b64Body[tailIndex] === "A" ? "B" : "A";
    const tamperedB64 = b64Body.slice(0, tailIndex) + flippedChar + b64Body.slice(tailIndex + 1);
    const tamperedCsr = `-----BEGIN CERTIFICATE REQUEST-----\n${tamperedB64}\n-----END CERTIFICATE REQUEST-----\n`;
    let tamperedResult = false;
    try {
      tamperedResult = verifyZatcaCsrSignature(tamperedCsr, publicKeyPem);
    } catch {
      tamperedResult = false;
    }
    expect(tamperedResult).toBe(false);
  });

  it("generates a fresh, distinct keypair on every call", () => {
    const first = generateZatcaCsr(SUBJECT, SAN);
    const second = generateZatcaCsr(SUBJECT, SAN);
    expect(first.privateKeyPem).not.toBe(second.privateKeyPem);
    expect(first.csrPem).not.toBe(second.csrPem);
  });

  it("csrPemToBase64 strips the PEM armor and newlines into one continuous Base64 string, matching what ZATCA's API expects", () => {
    const { csrPem } = generateZatcaCsr(SUBJECT, SAN);
    const b64 = csrPemToBase64(csrPem);
    expect(b64).not.toContain("-----");
    expect(b64).not.toContain("\n");
    expect(Buffer.from(b64, "base64").toString("base64")).toBe(b64); // round-trips as valid base64
  });
});

describe("ZATCA credential encryption at rest", () => {
  beforeAll(() => {
    process.env.ZATCA_CREDENTIAL_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("round-trips a secret exactly", () => {
    const secret = "a-zatca-compliance-secret-value-123";
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it("produces different ciphertext for the same plaintext each time (random IV)", () => {
    const a = encryptSecret("same-value");
    const b = encryptSecret("same-value");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same-value");
    expect(decryptSecret(b)).toBe("same-value");
  });

  it("fails closed (throws) if the key is missing rather than falling back to plaintext", () => {
    const saved = process.env.ZATCA_CREDENTIAL_KEY;
    delete process.env.ZATCA_CREDENTIAL_KEY;
    try {
      expect(() => encryptSecret("x")).toThrow(/ZATCA_CREDENTIAL_KEY/);
    } finally {
      process.env.ZATCA_CREDENTIAL_KEY = saved;
    }
  });

  it("rejects a tampered ciphertext instead of silently returning garbage", () => {
    const encrypted = encryptSecret("tamper-test");
    const buf = Buffer.from(encrypted, "base64");
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff; // flip a byte in the ciphertext
    expect(() => decryptSecret(buf.toString("base64"))).toThrow();
  });
});
