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
    const { privateKeyPem, publicKeyPem, csrPem } = generateZatcaCsr(SUBJECT, SAN, "sandbox");

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
    const first = generateZatcaCsr(SUBJECT, SAN, "sandbox");
    const second = generateZatcaCsr(SUBJECT, SAN, "sandbox");
    expect(first.privateKeyPem).not.toBe(second.privateKeyPem);
    expect(first.csrPem).not.toBe(second.csrPem);
  });

  it("csrPemToBase64 strips the PEM armor and newlines into one continuous Base64 string, matching what ZATCA's API expects", () => {
    const { csrPem } = generateZatcaCsr(SUBJECT, SAN, "sandbox");
    const b64 = csrPemToBase64(csrPem);
    expect(b64).not.toContain("-----");
    expect(b64).not.toContain("\n");
    expect(Buffer.from(b64, "base64").toString("base64")).toBe(b64); // round-trips as valid base64
  });

  // Regression test for a real ZATCA sandbox rejection (400 "Invalid
  // Request" at the compliance-CSID step) caused by the extensionRequest
  // attribute not matching ZATCA's expected shape. Parses the CSR's DER
  // independently of forge's (RSA-only) CSR reader, the same way
  // verifyZatcaCsrSignature does, and checks for exactly the two
  // Extensions ZATCA's CSR config template requires.
  it("embeds a certificateTemplateName and a directoryName subjectAltName extension, per environment", () => {
    const { csrPem } = generateZatcaCsr(SUBJECT, SAN, "simulation");
    const der = Buffer.from(csrPemToBase64(csrPem), "base64");
    const top = forge.asn1.fromDer(forge.util.createBuffer(der.toString("binary")), { decodeBitStrings: false } as never);
    const [certificationRequestInfo] = top.value as forge.asn1.Asn1[];
    const [, , , attributes] = certificationRequestInfo!.value as forge.asn1.Asn1[];
    const [extensionRequestAttribute] = attributes!.value as forge.asn1.Asn1[];
    const [, extensionSet] = extensionRequestAttribute!.value as forge.asn1.Asn1[];
    const [extensionSequence] = extensionSet!.value as forge.asn1.Asn1[];
    const extensions = extensionSequence!.value as forge.asn1.Asn1[];

    const oidsSeen = extensions.map((ext) => {
      const [oidAsn1] = ext.value as forge.asn1.Asn1[];
      return forge.asn1.derToOid(oidAsn1!.value as string);
    });
    expect(oidsSeen).toContain("1.3.6.1.4.1.311.20.2"); // certificateTemplateName
    expect(oidsSeen).toContain("2.5.29.17"); // subjectAltName

    const templateExt = extensions[oidsSeen.indexOf("1.3.6.1.4.1.311.20.2")]!;
    const [, templateExtnValue] = templateExt.value as forge.asn1.Asn1[];
    const templateValueAsn1 = forge.asn1.fromDer(templateExtnValue!.value as string);
    expect(templateValueAsn1.value).toBe("PREZATCA-Code-Signing"); // "simulation" environment

    const sanExt = extensions[oidsSeen.indexOf("2.5.29.17")]!;
    const [, sanExtnValue] = sanExt.value as forge.asn1.Asn1[];
    const generalNames = forge.asn1.fromDer(sanExtnValue!.value as string);
    const [directoryName] = generalNames.value as forge.asn1.Asn1[];
    expect(directoryName!.tagClass).toBe(forge.asn1.Class.CONTEXT_SPECIFIC);
    expect(directoryName!.type).toBe(4); // GeneralName choice tag for directoryName
    const [rdnSequence] = directoryName!.value as forge.asn1.Asn1[];
    const rdnOids = (rdnSequence!.value as forge.asn1.Asn1[]).map((rdn) => {
      const [atv] = rdn.value as forge.asn1.Asn1[];
      const [oidAsn1] = atv!.value as forge.asn1.Asn1[];
      return forge.asn1.derToOid(oidAsn1!.value as string);
    });
    expect(rdnOids).toEqual(["2.5.4.5", "0.9.2342.19200300.100.1.1", "2.5.4.12", "2.5.4.26", "2.5.4.15"]);
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
