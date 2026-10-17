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
 * CSR CONTENT (verified against ZATCA's published OpenSSL CSR config
 * template and community reports of real 400 "Invalid CSR" rejections --
 * see https://zatca1.discourse.group, e.g. the "400 Bad Request Error When
 * Submitting CSR" thread): the extensionRequest attribute carries exactly
 * two Extensions:
 *   1. certificateTemplateName (OID 1.3.6.1.4.1.311.20.2), a PrintableString
 *      naming the environment -- "TSTZATCA-Code-Signing" (sandbox),
 *      "PREZATCA-Code-Signing" (simulation), or "ZATCA-Code-Signing"
 *      (production). Missing this entirely (as an earlier version of this
 *      module did) is itself enough to cause a 400.
 *   2. subjectAltName (OID 2.5.29.17), whose value is a SEQUENCE OF
 *      GeneralName containing exactly one directoryName [4] -- an
 *      RDNSequence of SN/UID/title/registeredAddress/businessCategory,
 *      not five ad-hoc top-level "Extensions" the way an earlier version of
 *      this module built it (that shape doesn't correspond to anything
 *      ZATCA's CSR parser looks for, and used OIDs -- e.g. 2.5.4.15 for
 *      both invoiceType and industryBusinessCategory -- that collided with
 *      each other).
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

// The five attribute types that make up the subjectAltName directoryName's
// RDNSequence -- each confirmed against ZATCA's published CSR config (its
// dir_sect/alt_names section uses exactly these RDN attribute types).
const SAN_RDN_OIDS = {
  egsSerialNumber: "2.5.4.5", // SN (serialNumber)
  vatRegistrationNumber: "0.9.2342.19200300.100.1.1", // UID (RFC 1274 userid, not an X.520 organizationIdentifier)
  invoiceType: "2.5.4.12", // title
  location: "2.5.4.26", // registeredAddress
  industryBusinessCategory: "2.5.4.15", // businessCategory
} as const;

const CERTIFICATE_TEMPLATE_NAME_OID = "1.3.6.1.4.1.311.20.2";
const SUBJECT_ALT_NAME_OID = "2.5.29.17";
const CERTIFICATE_TEMPLATE_NAMES = {
  sandbox: "TSTZATCA-Code-Signing",
  simulation: "PREZATCA-Code-Signing",
  production: "ZATCA-Code-Signing",
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

/** Extension ::= SEQUENCE { extnID OID, extnValue OCTET STRING } (critical defaults to FALSE, omitted). */
function extension(oid: string, extnValueDer: string) {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oid).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, extnValueDer),
  ]);
}

function certificateTemplateNameExtension(environment: keyof typeof CERTIFICATE_TEMPLATE_NAMES) {
  const value = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.PRINTABLESTRING, false, CERTIFICATE_TEMPLATE_NAMES[environment]);
  return extension(CERTIFICATE_TEMPLATE_NAME_OID, asn1.toDer(value).getBytes());
}

/**
 * subjectAltName extension carrying one directoryName GeneralName -- an
 * RDNSequence built the same way forge builds the Subject DN (each RDN a
 * SET of one AttributeTypeAndValue), reused here via the same
 * distinguishedNameToAsn1 helper rather than hand-rolling an identical
 * structure twice.
 */
function subjectAltNameExtension(san: CsrSanInput) {
  const rdnSequence = pki.distinguishedNameToAsn1({
    attributes: [
      { type: SAN_RDN_OIDS.egsSerialNumber, value: san.egsSerialNumber },
      { type: SAN_RDN_OIDS.vatRegistrationNumber, value: san.vatRegistrationNumber },
      { type: SAN_RDN_OIDS.invoiceType, value: san.invoiceType },
      { type: SAN_RDN_OIDS.location, value: san.location },
      { type: SAN_RDN_OIDS.industryBusinessCategory, value: san.industryBusinessCategory },
    ],
  });
  // GeneralName ::= CHOICE { ... directoryName [4] Name ... } -- [4] is
  // EXPLICIT (Name is itself a CHOICE), so it wraps the RDNSequence as its
  // one child rather than re-tagging it.
  const directoryName = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 4, true, [rdnSequence]);
  // SubjectAltName ::= SEQUENCE OF GeneralName -- one entry here.
  const generalNames = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [directoryName]);
  return extension(SUBJECT_ALT_NAME_OID, asn1.toDer(generalNames).getBytes());
}

/**
 * Generates a fresh secp256k1 keypair (the curve ZATCA's e-invoicing PKI
 * mandates -- not P-256/P-384) and a CSR signed with it.
 */
export function generateZatcaCsr(
  subject: CsrSubjectInput,
  san: CsrSanInput,
  environment: keyof typeof CERTIFICATE_TEMPLATE_NAMES,
): GeneratedCsr {
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

  const extensions = [certificateTemplateNameExtension(environment), subjectAltNameExtension(san)];
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
export const ZATCA_CSR_OIDS = {
  EC_PUBLIC_KEY_OID,
  SECP256K1_OID,
  ECDSA_WITH_SHA256_OID,
  EXTENSION_REQUEST_OID,
  CERTIFICATE_TEMPLATE_NAME_OID,
  SUBJECT_ALT_NAME_OID,
  ...SAN_RDN_OIDS,
};
