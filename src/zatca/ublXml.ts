/**
 * ZATCA Phase 2 (Integration phase) XML export -- UBL 2.1 Invoice /
 * CreditNote documents shaped to ZATCA's e-invoicing implementation
 * standard, including the invoice-hash chain (see invoiceHash.ts) and the
 * embedded Phase 1 QR code.
 *
 * IMPORTANT SCOPE BOUNDARY: this produces a structurally correct,
 * ZATCA-shaped XML document for review, archival, or feeding into a
 * clearance pipeline -- it is NOT a certified ZATCA submission. Two things
 * real Phase 2 compliance requires cannot be done here without a live
 * ZATCA account:
 *   1. A cryptographic stamp signed with a ZATCA-issued CSID (Cryptographic
 *      Stamp Identifier), obtained by onboarding an EGS unit through
 *      ZATCA's Fatoora portal/API. There's no substitute for that key --
 *      this export's <ext:UBLExtensions> block is left as an explicit
 *      placeholder, never a fake or self-signed signature.
 *   2. Live reporting (simplified invoices, within 24h) or clearance
 *      (standard invoices, real-time) through ZATCA's API, which requires
 *      that same onboarded credential.
 * The exact subtype codes and business-rule details below reflect ZATCA's
 * publicly documented UBL structure as of this codebase's knowledge cutoff
 * -- verify against ZATCA's current Data Dictionary before relying on this
 * for a real submission, since the spec is versioned and does change.
 */

export interface UblParty {
  registrationName: string;
  vatNumber: string | null;
  crNumber: string | null;
  address: string | null;
  city: string | null;
}

export type UblVatCategory = "S" | "Z" | "E" | "O"; // Standard / Zero-rated / Exempt / Out-of-scope

export interface UblLine {
  lineNumber: number;
  description: string;
  quantity: number;
  netAmount: number;
  vatAmount: number;
  vatRate: number;
  vatCategory: UblVatCategory;
}

export interface UblDocumentCommon {
  documentNumber: string;
  uuid: string;
  issueDate: string; // YYYY-MM-DD
  issueTime: string; // HH:MM:SS
  isSimplified: boolean;
  currency: string;
  supplier: UblParty;
  customer: UblParty | null;
  lines: UblLine[];
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  invoiceHash: string;
  previousInvoiceHash: string;
  qrBase64: string;
}

export interface UblInvoiceInput extends UblDocumentCommon {
  paymentMeansCode: string;
}

export interface UblCreditNoteInput extends UblDocumentCommon {
  originalInvoiceNumber: string;
  reason: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function n2(value: number): string {
  return value.toFixed(2);
}

// Every UN/CEFACT quantity in this codebase's line items is treated as
// "piece" (PCE) -- a real deployment would map each units_of_measure row to
// its correct UN/CEFACT Recommendation 20 code (KGM, MTR, LTR, ...); that
// mapping isn't part of this schema yet, so it's a deliberate, documented
// simplification rather than a guess dressed up as fact.
const UNIT_CODE = "PCE";

function partyBlock(tag: "cac:AccountingSupplierParty" | "cac:AccountingCustomerParty", party: UblParty): string {
  return `  <${tag}>
    <cac:Party>
      ${party.crNumber ? `<cac:PartyIdentification>\n        <cbc:ID schemeID="CRN">${escapeXml(party.crNumber)}</cbc:ID>\n      </cac:PartyIdentification>` : ""}
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(party.address ?? "")}</cbc:StreetName>
        <cbc:CityName>${escapeXml(party.city ?? "")}</cbc:CityName>
        <cac:Country>
          <cbc:IdentificationCode>SA</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(party.vatNumber ?? "")}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(party.registrationName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </${tag}>`;
}

/** One cac:TaxSubtotal per distinct (rate, category) pair, aggregated across lines -- the standard UBL pattern, not one subtotal per line. */
function taxSubtotals(lines: UblLine[], currency: string): string {
  const groups = new Map<string, { net: number; vat: number; rate: number; category: UblVatCategory }>();
  for (const line of lines) {
    const key = `${line.vatCategory}:${line.vatRate}`;
    const existing = groups.get(key);
    if (existing) {
      existing.net += line.netAmount;
      existing.vat += line.vatAmount;
    } else {
      groups.set(key, { net: line.netAmount, vat: line.vatAmount, rate: line.vatRate, category: line.vatCategory });
    }
  }
  return Array.from(groups.values())
    .map(
      (g) => `      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${currency}">${n2(g.net)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${currency}">${n2(g.vat)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:ID>${g.category}</cbc:ID>
          <cbc:Percent>${n2(g.rate)}</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID>VAT</cbc:ID>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>`,
    )
    .join("\n");
}

function invoiceLine(tag: "cac:InvoiceLine" | "cac:CreditNoteLine", qtyTag: "cbc:InvoicedQuantity" | "cbc:CreditedQuantity", line: UblLine, currency: string): string {
  return `  <${tag}>
    <cbc:ID>${line.lineNumber}</cbc:ID>
    <${qtyTag} unitCode="${UNIT_CODE}">${line.quantity}</${qtyTag}>
    <cbc:LineExtensionAmount currencyID="${currency}">${n2(line.netAmount)}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${currency}">${n2(line.vatAmount)}</cbc:TaxAmount>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${escapeXml(line.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${line.vatCategory}</cbc:ID>
        <cbc:Percent>${n2(line.vatRate)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${n2(line.quantity !== 0 ? line.netAmount / line.quantity : 0)}</cbc:PriceAmount>
    </cac:Price>
  </${tag}>`;
}

// Placeholder for the real XAdES enveloped signature a ZATCA-issued CSID
// would produce. Left inert (not a fake signature over anything) so it's
// unambiguous that this document is unsigned -- see the module doc comment.
function extensionsBlock(): string {
  return `  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>
      <ext:ExtensionContent>
        <!-- UNSIGNED: real ZATCA Phase 2 clearance requires a cryptographic
             stamp from a ZATCA-issued CSID (Cryptographic Stamp Identifier),
             obtained by onboarding an EGS unit through ZATCA's Fatoora
             platform. That step cannot be performed without a live ZATCA
             account and is intentionally not simulated here. -->
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>`;
}

function qrAndHashBlock(qrBase64: string, invoiceHash: string, previousInvoiceHash: string): string {
  return `  <cac:AdditionalDocumentReference>
    <cbc:ID>QR</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qrBase64}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${previousInvoiceHash}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${invoiceHash}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>`;
}

const NAMESPACES = `xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"`;

/**
 * Builds the full UBL 2.1 Invoice XML. Excludes the invoice's own hash from
 * the hashed content by construction -- the caller computes invoiceHash
 * over exactly this function's output *before* that hash is known, so it
 * is never fed back into itself.
 */
export function buildZatcaInvoiceXml(input: UblInvoiceInput): string {
  const invoiceTypeCode = input.isSimplified ? "388" : "388"; // 388 = Tax Invoice in both cases; subtype below distinguishes
  const subtypeName = input.isSimplified ? "0200000" : "0100000"; // ZATCA invoice subtype: 02xxxxx simplified, 01xxxxx standard

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" ${NAMESPACES}>
${extensionsBlock()}
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${escapeXml(input.documentNumber)}</cbc:ID>
  <cbc:UUID>${input.uuid}</cbc:UUID>
  <cbc:IssueDate>${input.issueDate}</cbc:IssueDate>
  <cbc:IssueTime>${input.issueTime}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${subtypeName}">${invoiceTypeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${input.currency}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>${input.currency}</cbc:TaxCurrencyCode>
${qrAndHashBlock(input.qrBase64, input.invoiceHash, input.previousInvoiceHash)}
${partyBlock("cac:AccountingSupplierParty", input.supplier)}
${input.customer ? partyBlock("cac:AccountingCustomerParty", input.customer) : ""}
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>${input.paymentMeansCode}</cbc:PaymentMeansCode>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${input.currency}">${n2(input.vatAmount)}</cbc:TaxAmount>
${taxSubtotals(input.lines, input.currency)}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${input.currency}">${n2(input.netAmount)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${input.currency}">${n2(input.netAmount)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${input.currency}">${n2(input.grossAmount)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${input.currency}">${n2(input.grossAmount)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${input.lines.map((l) => invoiceLine("cac:InvoiceLine", "cbc:InvoicedQuantity", l, input.currency)).join("\n")}
</Invoice>`;
}

export function buildZatcaCreditNoteXml(input: UblCreditNoteInput): string {
  const subtypeName = input.isSimplified ? "0200000" : "0100000";

  return `<?xml version="1.0" encoding="UTF-8"?>
<CreditNote xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" ${NAMESPACES.replace(
    "Invoice-2",
    "CreditNote-2",
  )}>
${extensionsBlock()}
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${escapeXml(input.documentNumber)}</cbc:ID>
  <cbc:UUID>${input.uuid}</cbc:UUID>
  <cbc:IssueDate>${input.issueDate}</cbc:IssueDate>
  <cbc:IssueTime>${input.issueTime}</cbc:IssueTime>
  <cbc:CreditNoteTypeCode name="${subtypeName}">381</cbc:CreditNoteTypeCode>
  <cbc:DocumentCurrencyCode>${input.currency}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>${input.currency}</cbc:TaxCurrencyCode>
${qrAndHashBlock(input.qrBase64, input.invoiceHash, input.previousInvoiceHash)}
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${escapeXml(input.originalInvoiceNumber)}</cbc:ID>
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>
  <cac:DiscrepancyResponse>
    <cbc:ResponseCode>ACCEPTED</cbc:ResponseCode>
    <cbc:Description>${escapeXml(input.reason)}</cbc:Description>
  </cac:DiscrepancyResponse>
${partyBlock("cac:AccountingSupplierParty", input.supplier)}
${input.customer ? partyBlock("cac:AccountingCustomerParty", input.customer) : ""}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${input.currency}">${n2(input.vatAmount)}</cbc:TaxAmount>
${taxSubtotals(input.lines, input.currency)}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${input.currency}">${n2(input.netAmount)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${input.currency}">${n2(input.netAmount)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${input.currency}">${n2(input.grossAmount)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${input.currency}">${n2(input.grossAmount)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${input.lines.map((l) => invoiceLine("cac:CreditNoteLine", "cbc:CreditedQuantity", l, input.currency)).join("\n")}
</CreditNote>`;
}

/** vat_rate alone can't distinguish zero-rated exports from VAT-exempt items (both show 0%) -- this schema doesn't persist tax_type on the line, only the rate, so 0% is treated as zero-rated as the more common case. A future migration linking invoice lines back to tax_codes would resolve this properly. */
export function vatCategoryFromRate(rate: number): UblVatCategory {
  return rate > 0 ? "S" : "Z";
}
