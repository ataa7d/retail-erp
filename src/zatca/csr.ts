/**
 * ZATCA e-invoicing CSR (Certificate Signing Request) generation -- the
 * first real onboarding step: an EGS (E-invoice Generation Solution) unit
 * generates its own secp256k1 keypair and a CSR carrying ZATCA-specific
 * subject/extension fields, which ZATCA's Compliance CSID API exchanges
 * for a certificate (see apiClient.ts).
 *
 * IMPLEMENTATION NOTE: node-forge's high-level `pki.createCertificationRequest()`
 * path is RSA-only under the hood (publicKeyFromPem/publicKeyToAsn1 only
 * recognize the RSA OID -- confirmed by hitting "Cannot read public key.
 * Unknown OID." when an EC key was fed through it). ZATCA mandates
 * secp256k1, so this builds the PKCS#10 structure directly from forge's
 * low-level ASN.1 primitives instead: the subject Name still goes through
 * forge's generic (key-type-agnostic) distinguishedNameToAsn1, but the
 * SubjectPublicKeyInfo is taken verbatim from Node's own SPKI/DER export
 * (Node's crypto does support secp256k1 natively) and the final signature
 * is produced with Node's crypto.sign, which already emits the DER
 * ECDSA-signature format X.509/PKCS#10 requires.
 *
 * ACCURACY NOTE: the subject fields (C/O/OU/CN) below are well-established
 * and confident. The extensionRequest custom fields -- EGS serial number,
 * VAT number, invoice-type support flags, location, industry -- are
 * ZATCA-specific extensions whose exact OIDs and inner encoding this
 * module implements to the best of its knowledge, but which genuinely
 * need verification against ZATCA's current CSR config template
 * (published in their onboarding SDK/documentation) before relying on
 * this for a real submission: a wrong OID or format here is the kind of
 * thing that fails silently at generation time and only surfaces as a
 * rejection from ZATCA's API. All of it lives in SAN_FIELD_OIDS below so
 * it's a one-place fix if ZATCA's spec differs from what's encoded here.
 */
import forge from "node-forge";
import { generateKeyPairSync, createPublicKey, sign as nodeSign, verify as nodeVerify } from "node:crypto";

const { asn1, util, pki } = forge;

export interface CsrSubjectInput {
  /** The company's registered legal name (or branch name for a branch-specific EGS unit). */
  organizationName: string;
  /** Branch/business unit name -- ZATCA's OU field. */
  organizationalUnitName: string;
  /** EGS common name -- typically "<solution name> - <device/store identifier>". */
  commonName: string;
}

export interface CsrSanInput {
  /** ZATCA's egs serial number format: "1-<solution name>|2-<model>|3-<serial>". */
  egsSerialNumber: string;
  /** 15-digit VAT registration number. */
  vatRegistrationNumber: string;
  /** City / branch location, free text. */
  location: string;
  /** GS1 or free-text industry/business category. */
  industryBusinessCategory: string;
  /** 4-char string of 0/1 flags: [invoicing, ...reserved] -- "1100" = supports standard+simplified invoices. Kept simple; adjust per ZATCA's current InvoiceType encoding. */
  invoiceType: string;
}

// Best-effort mapping of ZATCA's documented CSR custom extension OIDs --
// see the module doc comment. Centralized here so a spec mismatch is a
// one-line fix rather than a hunt through ASN.1-building code.
const SAN_FIELD_OIDS = {
  egsSerialNumber: "2.5.4.5", // serialNumber
  vatRegistrationNumber: "1.3.6.1.4.1.311.20.2.3", // organizationIdentifier-style slot (verify)
  invoiceType: "2.5.4.15", // businessCategory-style slot (verify)
  location: "2.5.4.26", // registeredAddress-style slot (verify)
  industryBusinessCategory: "2.5.4.15", // businessCategory (verify: ZATCA may want a distinct OID from invoiceType)
} as const;

const EC_PUBLIC_KEY_OID = "1.2.840.10045.2.1"; // id-ecPublicKey
const SECP256K1_OID = "1.3.132.0.10";
const ECDSA_WITH_SHA256_OID = "1.2.840.10045.4.3.2";
const EXTENSION_REQUEST_OID = "1.2.840.113549.1.9.14"; // PKCS#9 extensionRequest

export interface GeneratedCsr {
  /** PKCS#8 PEM, never logged or returned to the client -- encrypted at rest immediately by the caller. */
  privateKeyPem: string;
  publicKeyPem: string;
  /** PKCS#10 PEM. This is what's Base64-wrapped and sent to ZATCA's Compliance CSID endpoint. */
  csrPem: string;
}

// @types/node-forge only types fromDer's 2nd arg as boolean|undefined, but
// the actual implementation also accepts an options object (confirmed
// against node_modules/node-forge/lib/asn1.js) -- this narrow cast covers
// that type-definition gap without loosening anything else.
type Asn1FromDerFn = (bytes: forge.util.ByteStringBuffer, options?: { decodeBitStrings?: boolean }) => forge.asn1.Asn1;
const fromDerNoBitStringDecode = asn1.fromDer as unknown as Asn1FromDerFn;

function derToAsn1(der: Buffer) {
  // decodeBitStrings: false for the same reason as verifyZatcaCsrSignature
  // below -- never let forge guess at re-interpreting a BIT STRING's raw
  // bytes (here, the SubjectPublicKeyInfo's EC point) as nested ASN.1.
  return fromDerNoBitStringDecode(util.createBuffer(der.toString("binary")), { decodeBitStrings: false });
}

function utf8StringAttribute(oid: string, value: string) {
  // Encoded as: Extension ::= SEQUENCE { extnID OID, extnValue OCTET STRING }
  // (critical defaults to FALSE, omitted) with extnValue containing a plain
  // UTF8String -- a common simplification seen in community ZATCA CSR
  // implementations. Verify against ZATCA's spec if a submission is rejected
  // specifically over one of these fields.
  const utf8Value = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTF8, false, forge.util.encodeUtf8(value));
  const extnValueDer = asn1.toDer(utf8Value).getBytes();
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oid).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, extnValueDer),
  ]);
}

/**
 * Generates a fresh secp256k1 keypair (the curve ZATCA's e-invoicing PKI
 * mandates -- not P-256/P-384) and a CSR signed with it.
 */
export function generateZatcaCsr(subject: CsrSubjectInput, san: CsrSanInput): GeneratedCsr {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "secp256k1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  const publicKeyDer = createPublicKey(publicKey).export({ type: "spki", format: "der" }) as Buffer;
  const subjectPublicKeyInfoAsn1 = derToAsn1(publicKeyDer);

  const version = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, String.fromCharCode(0));

  // pki.distinguishedNameToAsn1's low-level _dnToAsn1 wants the raw OID in
  // `type` directly -- it doesn't resolve shortName/name itself (that only
  // happens in higher-level cert-building helpers this module doesn't use).
  const subjectAsn1 = pki.distinguishedNameToAsn1({
    attributes: [
      { type: "2.5.4.6", value: "SA" }, // C
      { type: "2.5.4.10", value: subject.organizationName }, // O
      { type: "2.5.4.11", value: subject.organizationalUnitName }, // OU
      { type: "2.5.4.3", value: subject.commonName }, // CN
    ],
  });

  const extensions = [
    utf8StringAttribute(SAN_FIELD_OIDS.egsSerialNumber, san.egsSerialNumber),
    utf8StringAttribute(SAN_FIELD_OIDS.vatRegistrationNumber, san.vatRegistrationNumber),
    utf8StringAttribute(SAN_FIELD_OIDS.invoiceType, san.invoiceType),
    utf8StringAttribute(SAN_FIELD_OIDS.location, san.location),
    utf8StringAttribute(SAN_FIELD_OIDS.industryBusinessCategory, san.industryBusinessCategory),
  ];
  const extensionSequence = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, extensions);
  const extensionRequestAttribute = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(EXTENSION_REQUEST_OID).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [extensionSequence]),
  ]);
  // Attributes ::= [0] IMPLICIT SET OF Attribute -- context-specific,
  // constructed, tag 0.
  const attributesAsn1 = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [extensionRequestAttribute]);

  const certificationRequestInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    version,
    subjectAsn1,
    subjectPublicKeyInfoAsn1,
    attributesAsn1,
  ]);
  const certificationRequestInfoDer = Buffer.from(asn1.toDer(certificationRequestInfo).getBytes(), "binary");

  // ECDSA-SHA256 over the CertificationRequestInfo DER -- Node's crypto.sign
  // for an EC key already produces the DER ECDSA-Sig-Value (r,s SEQUENCE)
  // format X.509/PKCS#10 signatures require, so it's embedded as-is.
  const signatureDer = nodeSign("sha256", certificationRequestInfoDer, privateKey);

  const signatureAlgorithm = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(ECDSA_WITH_SHA256_OID).getBytes()),
  ]);
  // BIT STRING: a leading 0x00 "unused bits" byte, then the raw signature bytes.
  const signatureBitString = asn1.create(
    asn1.Class.UNIVERSAL,
    asn1.Type.BITSTRING,
    false,
    "\x00" + signatureDer.toString("binary"),
  );

  const csrAsn1 = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    certificationRequestInfo,
    signatureAlgorithm,
    signatureBitString,
  ]);
  const csrDer = Buffer.from(asn1.toDer(csrAsn1).getBytes(), "binary");
  const csrPem = derToPem(csrDer, "CERTIFICATE REQUEST");

  // Self-check before ever handing this to a caller: node-forge can't read
  // an EC CSR back (see the module doc comment), so this re-verifies the
  // signature independently with Node's own crypto rather than skipping
  // verification entirely -- a construction bug here must fail loud, not
  // surface later as an opaque ZATCA API rejection.
  if (!verifyZatcaCsrSignature(csrPem, publicKey)) {
    throw new Error("generated ZATCA CSR failed self-verification -- this is a bug in CSR construction, not a ZATCA-side rejection");
  }

  return { privateKeyPem: privateKey, publicKeyPem: publicKey, csrPem };
}

/**
 * Independently verifies a CSR's signature against its own embedded
 * CertificationRequestInfo, without going through node-forge's RSA-only
 * CSR reader. Exported so it's usable both as this module's own
 * self-check and by anything that wants to sanity-check a CSR later.
 */
export function verifyZatcaCsrSignature(csrPem: string, publicKeyPem: string): boolean {
  const der = Buffer.from(csrPemToBase64(csrPem), "base64");
  // decodeBitStrings must be off: forge's default tries to auto-decode a
  // BIT STRING's content as nested ASN.1 when it looks parseable as such --
  // and an ECDSA-Sig-Value (SEQUENCE of two INTEGERs) does, which silently
  // replaced .value with a parsed [composed] array instead of the raw
  // signature bytes and broke verification until traced down here.
  const top = fromDerNoBitStringDecode(util.createBuffer(der.toString("binary")), { decodeBitStrings: false });
  const [certificationRequestInfo, , signatureBitStringAsn1] = top.value as forge.asn1.Asn1[];
  if (!certificationRequestInfo || !signatureBitStringAsn1) return false;

  const certificationRequestInfoDer = Buffer.from(asn1.toDer(certificationRequestInfo).getBytes(), "binary");
  // BIT STRING value starts with a 1-byte "unused bits" count (0 here).
  const bitStringValue = (signatureBitStringAsn1 as forge.asn1.Asn1).value as string;
  const signatureDer = Buffer.from(bitStringValue.slice(1), "binary");

  return nodeVerify("sha256", certificationRequestInfoDer, publicKeyPem, signatureDer);
}

function derToPem(der: Buffer, label: string): string {
  const b64 = der.toString("base64");
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/** The Base64 form ZATCA's Compliance CSID API expects in the `csr` field -- the PEM with headers/footers and newlines stripped. */
export function csrPemToBase64(csrPem: string): string {
  return csrPem
    .replace(/-----BEGIN CERTIFICATE REQUEST-----/, "")
    .replace(/-----END CERTIFICATE REQUEST-----/, "")
    .replace(/\r?\n/g, "");
}

// Referenced only in the doc comment above / for future readers checking
// which OIDs this module assumes; kept as a named export so it's
// discoverable without grepping.
export const ZATCA_CSR_OIDS = { EC_PUBLIC_KEY_OID, SECP256K1_OID, ECDSA_WITH_SHA256_OID, EXTENSION_REQUEST_OID, ...SAN_FIELD_OIDS };
