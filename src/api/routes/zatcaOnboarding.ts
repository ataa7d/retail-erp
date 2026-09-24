import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { NotFoundError, BusinessRuleError } from "../errors.js";
import { generateZatcaCsr, csrPemToBase64 } from "../../zatca/csr.js";
import { encryptSecret, decryptSecret } from "../../zatca/credentialCrypto.js";
import {
  requestComplianceCsid,
  submitComplianceInvoice,
  requestProductionCsid,
  ZATCA_SANDBOX_ENVIRONMENT,
  ZATCA_SIMULATION_ENVIRONMENT,
  ZATCA_PRODUCTION_ENVIRONMENT,
  ZatcaApiError,
  type ZatcaEnvironment,
} from "../../zatca/apiClient.js";
import { renderSalesInvoiceXml, renderCreditNoteXml } from "../../zatca/invoiceXmlService.js";
import { computeInvoiceHash } from "../../zatca/invoiceHash.js";
import { runZatcaReadinessCheck } from "../../zatca/readinessCheck.js";

function environmentFor(name: string): ZatcaEnvironment {
  if (name === "production") return ZATCA_PRODUCTION_ENVIRONMENT;
  if (name === "simulation") return ZATCA_SIMULATION_ENVIRONMENT;
  return ZATCA_SANDBOX_ENVIRONMENT;
}

const csrSchema = z.object({
  environment: z.enum(["sandbox", "simulation", "production"]).default("sandbox"),
  organizationalUnitName: z.string().min(1),
  commonName: z.string().min(1),
  egsSerialNumber: z.string().min(1),
  location: z.string().min(1),
  industryBusinessCategory: z.string().min(1),
  invoiceType: z
    .string()
    .regex(/^[01]{4}$/, "invoiceType must be 4 digits of 0/1")
    .default("1100"),
});

const complianceCsidSchema = z.object({
  otp: z.string().min(1),
});

const complianceCheckSchema = z.object({
  documentType: z.enum(["standard_invoice", "simplified_invoice", "standard_credit_note", "simplified_credit_note"]),
  sourceInvoiceId: z.string().uuid(),
});

// Redacts every secret-bearing column before a row ever reaches an HTTP
// response -- the raw values only exist decrypted for the instant a
// ZATCA API call needs them (see the routes below), never returned to the client.
function toPublicOnboardingRow(row: Record<string, unknown>) {
  const { private_key_pem_encrypted, compliance_secret_encrypted, production_secret_encrypted, ...rest } = row;
  void private_key_pem_encrypted;
  void compliance_secret_encrypted;
  void production_secret_encrypted;
  return {
    ...rest,
    hasPrivateKey: Boolean(private_key_pem_encrypted),
    hasComplianceSecret: Boolean(compliance_secret_encrypted),
    hasProductionSecret: Boolean(production_secret_encrypted),
  };
}

export async function zatcaOnboardingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/zatca-onboarding", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query(`SELECT * FROM zatca_onboarding WHERE company_id = $1`, [request.companyId]);
    if (result.rows.length === 0) return { status: "not_started" };
    return toPublicOnboardingRow(result.rows[0]!);
  });

  app.get("/zatca-onboarding/compliance-checks", { preHandler: app.authenticate }, async (request) => {
    const onboarding = await pool.query<{ id: string }>(`SELECT id FROM zatca_onboarding WHERE company_id = $1`, [request.companyId]);
    if (onboarding.rows.length === 0) return [];
    const result = await pool.query(
      `SELECT id, document_type, source_invoice_id, passed, submitted_at
       FROM zatca_compliance_checks WHERE zatca_onboarding_id = $1 ORDER BY submitted_at DESC`,
      [onboarding.rows[0]!.id],
    );
    return result.rows;
  });

  app.get("/zatca-onboarding/readiness", { preHandler: app.authenticate }, async (request) => {
    return runZatcaReadinessCheck(pool, request.companyId);
  });

  // Step 1: generate this company's EGS keypair + CSR. Overwrites any
  // previous CSR/keypair for the company -- starting over is the normal
  // recovery path if an OTP expired or the wrong environment was picked,
  // not a special case.
  app.post(
    "/zatca-onboarding/csr",
    { preHandler: [app.authenticate, app.requirePermission("admin.zatca_onboarding.manage")] },
    async (request, reply) => {
      const body = csrSchema.parse(request.body);
      const company = await pool.query<{ name_en: string; vat_registration_number: string | null }>(
        `SELECT name_en, vat_registration_number FROM companies WHERE id = $1`,
        [request.companyId],
      );
      if (company.rows.length === 0) throw new NotFoundError("company not found");
      const vatNumber = company.rows[0]!.vat_registration_number;
      if (!vatNumber || !/^\d{15}$/.test(vatNumber)) {
        throw new BusinessRuleError("company must have a 15-digit VAT registration number set before generating a ZATCA CSR");
      }

      const { privateKeyPem, publicKeyPem, csrPem } = generateZatcaCsr(
        { organizationName: company.rows[0]!.name_en, organizationalUnitName: body.organizationalUnitName, commonName: body.commonName },
        {
          egsSerialNumber: body.egsSerialNumber,
          vatRegistrationNumber: vatNumber,
          location: body.location,
          industryBusinessCategory: body.industryBusinessCategory,
          invoiceType: body.invoiceType,
        },
      );

      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO zatca_onboarding
             (company_id, environment, status, egs_common_name, egs_serial_number,
              private_key_pem_encrypted, public_key_pem, csr_pem, updated_by)
           VALUES ($1, $2, 'csr_generated', $3, $4, $5, $6, $7, $8)
           ON CONFLICT (company_id) DO UPDATE SET
             environment = EXCLUDED.environment,
             status = 'csr_generated',
             egs_common_name = EXCLUDED.egs_common_name,
             egs_serial_number = EXCLUDED.egs_serial_number,
             private_key_pem_encrypted = EXCLUDED.private_key_pem_encrypted,
             public_key_pem = EXCLUDED.public_key_pem,
             csr_pem = EXCLUDED.csr_pem,
             compliance_request_id = NULL, compliance_csid = NULL, compliance_secret_encrypted = NULL, compliance_csid_issued_at = NULL,
             compliance_checks_passed_at = NULL,
             production_request_id = NULL, production_csid = NULL, production_secret_encrypted = NULL, production_csid_issued_at = NULL,
             last_error = NULL, updated_by = EXCLUDED.updated_by`,
          [
            request.companyId,
            body.environment,
            body.commonName,
            body.egsSerialNumber,
            encryptSecret(privateKeyPem),
            publicKeyPem,
            csrPem,
            request.authUser.id,
          ],
        );
      }, request.authUser.id);

      reply.status(201);
      return { csrPem, status: "csr_generated" };
    },
  );

  // Step 2: exchange the stored CSR + the user's own ZATCA portal OTP for
  // a compliance certificate. The OTP is never stored -- it's single-use
  // and only needed for this one call.
  app.post(
    "/zatca-onboarding/compliance-csid",
    { preHandler: [app.authenticate, app.requirePermission("admin.zatca_onboarding.manage")] },
    async (request) => {
      const body = complianceCsidSchema.parse(request.body);
      const row = await pool.query(`SELECT * FROM zatca_onboarding WHERE company_id = $1`, [request.companyId]);
      if (row.rows.length === 0 || !row.rows[0]!.csr_pem) {
        throw new BusinessRuleError("generate a CSR first (POST /zatca-onboarding/csr)");
      }
      const onboarding = row.rows[0]!;
      const env = environmentFor(onboarding.environment);

      try {
        const result = await requestComplianceCsid(env, csrPemToBase64(onboarding.csr_pem), body.otp);
        await pool.query(
          `UPDATE zatca_onboarding
           SET status = 'compliance_csid_issued', compliance_request_id = $1, compliance_csid = $2,
               compliance_secret_encrypted = $3, compliance_csid_issued_at = now(), last_error = NULL, updated_by = $4
           WHERE company_id = $5`,
          [result.requestId, result.binarySecurityToken, encryptSecret(result.secret), request.authUser.id, request.companyId],
        );
        return { status: "compliance_csid_issued" };
      } catch (err) {
        const message = err instanceof ZatcaApiError ? err.message : err instanceof Error ? err.message : "unknown error";
        await pool.query(`UPDATE zatca_onboarding SET status = 'failed', last_error = $1, updated_by = $2 WHERE company_id = $3`, [
          message,
          request.authUser.id,
          request.companyId,
        ]);
        throw new BusinessRuleError(`ZATCA compliance CSID request failed: ${message}`);
      }
    },
  );

  // Step 3: submit one sample document (a real posted invoice/credit note
  // from this company's own data) for ZATCA's compliance validation.
  // ZATCA requires this for each document type an EGS unit will issue --
  // call it once per type (standard/simplified invoice, standard/simplified
  // credit note) before requesting the production CSID.
  app.post(
    "/zatca-onboarding/compliance-check",
    { preHandler: [app.authenticate, app.requirePermission("admin.zatca_onboarding.manage")] },
    async (request) => {
      const body = complianceCheckSchema.parse(request.body);
      const row = await pool.query(`SELECT * FROM zatca_onboarding WHERE company_id = $1`, [request.companyId]);
      if (row.rows.length === 0 || !row.rows[0]!.compliance_csid) {
        throw new BusinessRuleError("request a compliance CSID first (POST /zatca-onboarding/compliance-csid)");
      }
      const onboarding = row.rows[0]!;
      const env = environmentFor(onboarding.environment);
      const isCreditNote = body.documentType.endsWith("credit_note");

      const xml = isCreditNote
        ? await renderCreditNoteXml(pool, body.sourceInvoiceId, request.companyId)
        : await renderSalesInvoiceXml(pool, body.sourceInvoiceId, request.companyId);
      if (!xml) throw new NotFoundError("source document not found, not posted, or has no XML export yet");

      const uuid = randomUUID();
      const invoiceHash = computeInvoiceHash(xml);
      const secret = decryptSecret(onboarding.compliance_secret_encrypted);

      try {
        const result = await submitComplianceInvoice(env, onboarding.compliance_csid, secret, {
          invoiceBase64: Buffer.from(xml, "utf8").toString("base64"),
          invoiceHash,
          uuid,
        });
        // ZATCA's documented compliance response carries a top-level status
        // ("PASS"/"WARNING"/"ERROR") inside validationResults -- verify
        // against the current API contract; treated as passed only on an
        // explicit "PASS" so an unrecognized shape never silently counts as
        // a pass.
        const status = (result.validationResults as { status?: string } | undefined)?.status;
        const passed = status === "PASS";

        await pool.query(
          `INSERT INTO zatca_compliance_checks (zatca_onboarding_id, document_type, source_invoice_id, request_uuid, invoice_hash, passed, response_body)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [onboarding.id, body.documentType, body.sourceInvoiceId, uuid, invoiceHash, passed, JSON.stringify(result)],
        );

        if (passed) {
          await pool.query(
            `UPDATE zatca_onboarding SET status = 'compliance_checks_passed', compliance_checks_passed_at = now(), last_error = NULL, updated_by = $1 WHERE company_id = $2`,
            [request.authUser.id, request.companyId],
          );
        }

        return { passed, result };
      } catch (err) {
        const message = err instanceof ZatcaApiError ? err.message : err instanceof Error ? err.message : "unknown error";
        await pool.query(
          `INSERT INTO zatca_compliance_checks (zatca_onboarding_id, document_type, source_invoice_id, request_uuid, invoice_hash, passed, response_body)
           VALUES ($1, $2, $3, $4, $5, false, $6)`,
          [onboarding.id, body.documentType, body.sourceInvoiceId, uuid, invoiceHash, JSON.stringify({ error: message })],
        );
        throw new BusinessRuleError(`ZATCA compliance check failed: ${message}`);
      }
    },
  );

  // Step 4: exchange the compliance CSID for the real production CSID.
  app.post(
    "/zatca-onboarding/production-csid",
    { preHandler: [app.authenticate, app.requirePermission("admin.zatca_onboarding.manage")] },
    async (request) => {
      const row = await pool.query(`SELECT * FROM zatca_onboarding WHERE company_id = $1`, [request.companyId]);
      if (row.rows.length === 0 || row.rows[0]!.status !== "compliance_checks_passed") {
        throw new BusinessRuleError("complete compliance checks first (POST /zatca-onboarding/compliance-check) before requesting a production CSID");
      }
      const onboarding = row.rows[0]!;
      const env = environmentFor(onboarding.environment);
      const complianceSecret = decryptSecret(onboarding.compliance_secret_encrypted);

      try {
        const result = await requestProductionCsid(env, onboarding.compliance_request_id, onboarding.compliance_csid, complianceSecret);
        await pool.query(
          `UPDATE zatca_onboarding
           SET status = 'production_csid_issued', production_request_id = $1, production_csid = $2,
               production_secret_encrypted = $3, production_csid_issued_at = now(), last_error = NULL, updated_by = $4
           WHERE company_id = $5`,
          [result.requestId, result.binarySecurityToken, encryptSecret(result.secret), request.authUser.id, request.companyId],
        );
        return { status: "production_csid_issued" };
      } catch (err) {
        const message = err instanceof ZatcaApiError ? err.message : err instanceof Error ? err.message : "unknown error";
        await pool.query(`UPDATE zatca_onboarding SET status = 'failed', last_error = $1, updated_by = $2 WHERE company_id = $3`, [
          message,
          request.authUser.id,
          request.companyId,
        ]);
        throw new BusinessRuleError(`ZATCA production CSID request failed: ${message}`);
      }
    },
  );
}
