/**
 * ZATCA e-invoicing onboarding API client -- the three HTTP calls that
 * exchange a CSR for working credentials:
 *   1. Compliance CSID:   CSR + a one-time OTP (from ZATCA's Fatoora
 *      portal)  ->  a compliance certificate + secret.
 *   2. Compliance checks: submit sample invoices signed/hashed with that
 *      compliance certificate, so ZATCA can validate the EGS unit's output
 *      before trusting it.
 *   3. Production CSID:   the compliance certificate (once checks pass)
 *      -> the real production certificate + secret used for actual
 *      reporting/clearance.
 *
 * ENDPOINT ACCURACY NOTE: the paths and payload shapes below reflect
 * ZATCA's publicly documented Fatoora simulation/sandbox API to the best
 * of this codebase's knowledge. Verify them against ZATCA's current
 * developer documentation before relying on this for real onboarding --
 * government API specs are versioned and do change. Nothing in this file
 * is called automatically; every function here is invoked only when a
 * user explicitly triggers that onboarding step from the UI, and each
 * needs the user's own ZATCA sandbox/production OTP or credentials --
 * this codebase has none of its own.
 */

export interface ZatcaEnvironment {
  /** Base URL for the simulation/sandbox environment, no trailing slash. Default matches ZATCA's published simulation gateway. */
  baseUrl: string;
}

export const ZATCA_SANDBOX_ENVIRONMENT: ZatcaEnvironment = {
  baseUrl: "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal",
};

export const ZATCA_SIMULATION_ENVIRONMENT: ZatcaEnvironment = {
  baseUrl: "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation",
};

export const ZATCA_PRODUCTION_ENVIRONMENT: ZatcaEnvironment = {
  baseUrl: "https://gw-fatoora.zatca.gov.sa/e-invoicing/core",
};

export class ZatcaApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`ZATCA API request failed with status ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    // Accept-Version is required by ZATCA's gateway -- confirmed live
    // against the real sandbox host, which rejected a request missing it
    // with 406 "This Version is not supported or not provided in the
    // header." (caught during this feature's own live testing).
    headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Version": "V2", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    // ZATCA occasionally returns non-JSON error bodies (e.g. a gateway 502 HTML page)
  }
  if (!res.ok) throw new ZatcaApiError(res.status, parsed);
  return parsed;
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

export interface ComplianceCsidResult {
  requestId: string;
  /** The X.509 certificate ZATCA issues, Base64 -- this + secret form the credential used for every later call. */
  binarySecurityToken: string;
  secret: string;
}

/** Step 1: exchange a CSR + portal OTP for a compliance certificate. */
export async function requestComplianceCsid(env: ZatcaEnvironment, csrBase64: string, otp: string): Promise<ComplianceCsidResult> {
  const body = await postJson(`${env.baseUrl}/compliance`, { OTP: otp }, { csr: csrBase64 });
  return {
    requestId: String(body.requestID ?? body.requestId ?? ""),
    binarySecurityToken: String(body.binarySecurityToken ?? ""),
    secret: String(body.secret ?? ""),
  };
}

export interface ComplianceCheckInput {
  /** Base64 of the UBL XML document being validated. */
  invoiceBase64: string;
  invoiceHash: string;
  uuid: string;
}

export interface ComplianceCheckResult {
  validationResults: unknown;
  reportingStatus?: string;
  clearanceStatus?: string;
}

/** Step 2: submit one sample invoice for validation against the compliance certificate. Call once per required document type (standard invoice, standard credit note, simplified invoice, simplified credit note, ...) per ZATCA's compliance checklist. */
export async function submitComplianceInvoice(
  env: ZatcaEnvironment,
  csid: string,
  secret: string,
  input: ComplianceCheckInput,
): Promise<ComplianceCheckResult> {
  const body = await postJson(
    `${env.baseUrl}/compliance/invoices`,
    { Authorization: basicAuthHeader(csid, secret) },
    { invoiceHash: input.invoiceHash, uuid: input.uuid, invoice: input.invoiceBase64 },
  );
  return {
    validationResults: body.validationResults ?? body,
    reportingStatus: body.reportingStatus,
    clearanceStatus: body.clearanceStatus,
  };
}

export interface ProductionCsidResult {
  requestId: string;
  binarySecurityToken: string;
  secret: string;
}

/** Step 3: exchange the compliance certificate (once its checks have passed) for the real production certificate. */
export async function requestProductionCsid(
  env: ZatcaEnvironment,
  complianceRequestId: string,
  complianceCsid: string,
  complianceSecret: string,
): Promise<ProductionCsidResult> {
  const body = await postJson(
    `${env.baseUrl}/production/csids`,
    { Authorization: basicAuthHeader(complianceCsid, complianceSecret) },
    { compliance_request_id: complianceRequestId },
  );
  return {
    requestId: String(body.requestID ?? body.requestId ?? ""),
    binarySecurityToken: String(body.binarySecurityToken ?? ""),
    secret: String(body.secret ?? ""),
  };
}
