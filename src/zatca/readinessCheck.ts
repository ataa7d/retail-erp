/**
 * ZATCA production go-live readiness: a live, computed checklist against
 * this company's actual data -- not a static list of instructions. Every
 * item here is something this codebase can genuinely verify from its own
 * database; nothing claims ZATCA-side approval (only ZATCA can say that --
 * this only reports what's true or false about what's already been done).
 */
import type { Client, Pool } from "pg";
import { ZATCA_GENESIS_PREVIOUS_HASH } from "./invoiceHash.js";

type Queryable = Pool | Client;

export type ReadinessStatus = "pass" | "warn" | "fail";

export interface ReadinessCheck {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
}

export interface ReadinessReport {
  ready: boolean;
  checks: ReadinessCheck[];
}

const REQUIRED_DOCUMENT_TYPES = ["standard_invoice", "simplified_invoice", "standard_credit_note", "simplified_credit_note"] as const;

async function checkVatNumber(db: Queryable, companyId: string): Promise<ReadinessCheck> {
  const r = await db.query<{ vat_registration_number: string | null }>(`SELECT vat_registration_number FROM companies WHERE id = $1`, [
    companyId,
  ]);
  const vat = r.rows[0]?.vat_registration_number ?? null;
  // ZATCA VAT registration numbers are always 15 digits, and always both
  // start and end with '3' -- a well-known, stable rule (unlike the CSR
  // extension encoding elsewhere in this module, which is best-effort).
  if (vat && /^3\d{13}3$/.test(vat)) {
    return { id: "vat_number", label: "Company VAT registration number", status: "pass", detail: `Set and correctly formatted (${vat}).` };
  }
  return {
    id: "vat_number",
    label: "Company VAT registration number",
    status: "fail",
    detail: vat
      ? `"${vat}" is not a valid ZATCA VAT number -- must be exactly 15 digits, starting and ending with 3.`
      : "Not set. Required for the QR code, XML export, and CSR generation.",
  };
}

async function checkCrNumber(db: Queryable, companyId: string): Promise<ReadinessCheck> {
  const r = await db.query<{ cr_number: string | null }>(`SELECT cr_number FROM companies WHERE id = $1`, [companyId]);
  const cr = r.rows[0]?.cr_number ?? null;
  return cr
    ? { id: "cr_number", label: "Company CR (Commercial Registration) number", status: "pass", detail: `Set (${cr}).` }
    : { id: "cr_number", label: "Company CR (Commercial Registration) number", status: "warn", detail: "Not set at the company level -- fine if every branch has its own." };
}

async function checkBaseCurrency(db: Queryable, companyId: string): Promise<ReadinessCheck> {
  const r = await db.query<{ base_currency: string }>(`SELECT base_currency FROM companies WHERE id = $1`, [companyId]);
  const currency = r.rows[0]?.base_currency ?? "";
  return currency === "SAR"
    ? { id: "base_currency", label: "Base currency is SAR", status: "pass", detail: "SAR." }
    : { id: "base_currency", label: "Base currency is SAR", status: "fail", detail: `Base currency is "${currency}" -- ZATCA e-invoicing requires SAR reporting.` };
}

async function checkBranchAddresses(db: Queryable, companyId: string): Promise<ReadinessCheck> {
  const r = await db.query<{ missing: string }>(
    `SELECT COUNT(*) AS missing FROM branches WHERE company_id = $1 AND is_active = true AND (address IS NULL OR address = '' OR city IS NULL OR city = '')`,
    [companyId],
  );
  const missing = Number(r.rows[0]!.missing);
  return missing === 0
    ? { id: "branch_addresses", label: "Active branches have a postal address", status: "pass", detail: "All active branches have an address and city." }
    : { id: "branch_addresses", label: "Active branches have a postal address", status: "warn", detail: `${missing} active branch(es) are missing an address/city -- these feed the invoice XML's supplier party.` };
}

async function checkOnboardingStatus(db: Queryable, companyId: string): Promise<ReadinessCheck> {
  const r = await db.query<{ status: string; environment: string; last_error: string | null }>(
    `SELECT status, environment, last_error FROM zatca_onboarding WHERE company_id = $1`,
    [companyId],
  );
  const row = r.rows[0];
  if (!row) {
    return { id: "onboarding_status", label: "ZATCA onboarding complete", status: "fail", detail: "Onboarding hasn't been started (Administration > ZATCA Onboarding)." };
  }
  if (row.status === "production_csid_issued" && row.environment === "production") {
    return { id: "onboarding_status", label: "ZATCA onboarding complete", status: "pass", detail: "Production CSID issued in the production environment." };
  }
  if (row.status === "production_csid_issued") {
    return { id: "onboarding_status", label: "ZATCA onboarding complete", status: "warn", detail: `Production CSID issued, but the onboarding environment is "${row.environment}", not "production" -- re-run onboarding against production before going live.` };
  }
  return {
    id: "onboarding_status",
    label: "ZATCA onboarding complete",
    status: "fail",
    detail: `Current status: ${row.status}${row.last_error ? ` (last error: ${row.last_error})` : ""}. Complete all four onboarding steps first.`,
  };
}

async function checkComplianceCoverage(db: Queryable, companyId: string): Promise<ReadinessCheck> {
  const onboarding = await db.query<{ id: string }>(`SELECT id FROM zatca_onboarding WHERE company_id = $1`, [companyId]);
  if (onboarding.rows.length === 0) {
    return { id: "compliance_coverage", label: "Compliance checks passed for every document type", status: "fail", detail: "Onboarding hasn't been started." };
  }
  const r = await db.query<{ document_type: string }>(
    `SELECT DISTINCT document_type FROM zatca_compliance_checks WHERE zatca_onboarding_id = $1 AND passed = true`,
    [onboarding.rows[0]!.id],
  );
  const passedTypes = new Set(r.rows.map((row) => row.document_type));
  const missing = REQUIRED_DOCUMENT_TYPES.filter((t) => !passedTypes.has(t));
  return missing.length === 0
    ? { id: "compliance_coverage", label: "Compliance checks passed for every document type", status: "pass", detail: "Standard/simplified invoice and credit note all have a passed compliance check." }
    : { id: "compliance_coverage", label: "Compliance checks passed for every document type", status: "fail", detail: `Missing: ${missing.map((t) => t.replace(/_/g, " ")).join(", ")}.` };
}

async function checkTaxCodes(db: Queryable, companyId: string): Promise<ReadinessCheck> {
  const r = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM tax_codes WHERE company_id = $1 AND is_active = true AND tax_type = 'standard' AND rate > 0`,
    [companyId],
  );
  return Number(r.rows[0]!.count) > 0
    ? { id: "tax_codes", label: "A standard-rate VAT tax code exists", status: "pass", detail: "At least one active standard-rate tax code is configured." }
    : { id: "tax_codes", label: "A standard-rate VAT tax code exists", status: "fail", detail: "No active standard-rate tax code found (Accounting > Tax Codes)." };
}

async function checkItemsMissingTaxCode(db: Queryable, companyId: string): Promise<ReadinessCheck> {
  const r = await db.query<{ missing: string; total: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE default_tax_code_id IS NULL) AS missing,
       COUNT(*) AS total
     FROM items WHERE company_id = $1 AND is_active = true`,
    [companyId],
  );
  const missing = Number(r.rows[0]!.missing);
  const total = Number(r.rows[0]!.total);
  if (total === 0) return { id: "items_tax_codes", label: "Active items have a default tax code", status: "warn", detail: "No active items yet." };
  return missing === 0
    ? { id: "items_tax_codes", label: "Active items have a default tax code", status: "pass", detail: `All ${total} active item(s) have a default tax code.` }
    : { id: "items_tax_codes", label: "Active items have a default tax code", status: "warn", detail: `${missing} of ${total} active item(s) have no default tax code -- their invoice lines fall back to whatever rate is entered by hand.` };
}

async function checkPostedDocsHaveXml(db: Queryable, companyId: string): Promise<ReadinessCheck> {
  const r = await db.query<{ missing: string }>(
    `SELECT
       (SELECT COUNT(*) FROM sales_invoices WHERE company_id = $1 AND document_status = 'posted' AND xml_invoice_hash IS NULL) +
       (SELECT COUNT(*) FROM credit_notes WHERE company_id = $1 AND document_status = 'posted' AND xml_invoice_hash IS NULL) AS missing`,
    [companyId],
  );
  const missing = Number(r.rows[0]!.missing);
  return missing === 0
    ? { id: "xml_coverage", label: "Every posted document has its ZATCA XML hash", status: "pass", detail: "No posted invoices or credit notes are missing their XML hash." }
    : {
        id: "xml_coverage",
        label: "Every posted document has its ZATCA XML hash",
        status: "fail",
        detail: `${missing} posted document(s) have no XML hash -- their generation silently failed at posting time (commonly a missing VAT number at that moment). Run \`npm run backfill:zatca-xml\` after fixing the underlying cause.`,
      };
}

/**
 * Walks the full posted-document chain in posted_at order and verifies
 * every link: doc[0]'s previous hash is the ZATCA genesis value, and each
 * later doc's previous hash exactly equals the prior doc's own hash. A
 * genuine algorithmic integrity check, not just a presence check -- this
 * is exactly the kind of tampering/gap ZATCA's hash chain exists to catch.
 */
async function checkHashChainIntegrity(db: Queryable, companyId: string): Promise<ReadinessCheck> {
  const r = await db.query<{ document_number: string; xml_invoice_hash: string | null; xml_previous_invoice_hash: string | null }>(
    `SELECT document_number, xml_invoice_hash, xml_previous_invoice_hash, posted_at FROM (
       SELECT document_number, xml_invoice_hash, xml_previous_invoice_hash, posted_at FROM sales_invoices
         WHERE company_id = $1 AND document_status = 'posted'
       UNION ALL
       SELECT document_number, xml_invoice_hash, xml_previous_invoice_hash, posted_at FROM credit_notes
         WHERE company_id = $1 AND document_status = 'posted'
     ) chain
     ORDER BY posted_at ASC`,
    [companyId],
  );

  if (r.rows.length === 0) {
    return { id: "hash_chain", label: "XML invoice-hash chain is unbroken", status: "warn", detail: "No posted documents yet." };
  }

  let expectedPrevious = ZATCA_GENESIS_PREVIOUS_HASH;
  for (const row of r.rows) {
    if (row.xml_invoice_hash === null) {
      // Already reported by checkPostedDocsHaveXml -- skip it here rather
      // than cascading one missing hash into a false chain-break report
      // for every document after it.
      continue;
    }
    if (row.xml_previous_invoice_hash !== expectedPrevious) {
      return {
        id: "hash_chain",
        label: "XML invoice-hash chain is unbroken",
        status: "fail",
        detail: `Chain break at ${row.document_number}: expected previous hash did not match. This should never happen from normal use -- investigate before going live.`,
      };
    }
    expectedPrevious = row.xml_invoice_hash;
  }
  return { id: "hash_chain", label: "XML invoice-hash chain is unbroken", status: "pass", detail: `Verified across ${r.rows.length} posted document(s).` };
}

async function checkOpenFiscalPeriod(db: Queryable, companyId: string): Promise<ReadinessCheck> {
  const r = await db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM fiscal_periods WHERE company_id = $1 AND status = 'open'`, [
    companyId,
  ]);
  return Number(r.rows[0]!.count) > 0
    ? { id: "open_period", label: "An open fiscal period exists", status: "pass", detail: "At least one fiscal period is open for posting." }
    : { id: "open_period", label: "An open fiscal period exists", status: "fail", detail: "No open fiscal period -- no new invoice can post at all." };
}

async function checkActivePosDevices(db: Queryable, companyId: string): Promise<ReadinessCheck> {
  const r = await db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM pos_devices WHERE company_id = $1 AND status = 'active'`, [
    companyId,
  ]);
  const count = Number(r.rows[0]!.count);
  return count > 0
    ? { id: "pos_devices", label: "At least one active POS device is registered", status: "pass", detail: `${count} active device(s).` }
    : { id: "pos_devices", label: "At least one active POS device is registered", status: "warn", detail: "No active POS devices -- fine if only issuing wholesale invoices." };
}

export async function runZatcaReadinessCheck(db: Queryable, companyId: string): Promise<ReadinessReport> {
  const checks = await Promise.all([
    checkVatNumber(db, companyId),
    checkCrNumber(db, companyId),
    checkBaseCurrency(db, companyId),
    checkBranchAddresses(db, companyId),
    checkOnboardingStatus(db, companyId),
    checkComplianceCoverage(db, companyId),
    checkTaxCodes(db, companyId),
    checkItemsMissingTaxCode(db, companyId),
    checkPostedDocsHaveXml(db, companyId),
    checkHashChainIntegrity(db, companyId),
    checkOpenFiscalPeriod(db, companyId),
    checkActivePosDevices(db, companyId),
  ]);

  const ready = checks.every((c) => c.status !== "fail");
  return { ready, checks };
}
