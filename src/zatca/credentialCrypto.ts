/**
 * At-rest encryption for ZATCA onboarding secrets (the EGS private key, and
 * the compliance/production CSID secrets ZATCA issues) -- these are real
 * credentials that grant the ability to submit invoices as this company,
 * so they're never stored in plaintext, unlike everything else in this
 * schema.
 *
 * AES-256-GCM with a key from ZATCA_CREDENTIAL_KEY (base64, 32 bytes).
 * Deliberately throws at startup-adjacent call time rather than silently
 * falling back to plaintext if that env var is missing or malformed --
 * see rule: don't validate for scenarios that can't happen, but a missing
 * encryption key for real credentials is exactly the kind of boundary
 * that must fail loud.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function getKey(): Buffer {
  const b64 = process.env.ZATCA_CREDENTIAL_KEY;
  if (!b64) {
    throw new Error(
      "ZATCA_CREDENTIAL_KEY is not set -- generate one with `node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"` and add it to .env before using ZATCA onboarding",
    );
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error(`ZATCA_CREDENTIAL_KEY must decode to exactly 32 bytes, got ${key.length}`);
  }
  return key;
}

/** iv(12) + authTag(16) + ciphertext, all Base64 in one string so it's one TEXT column. */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const key = getKey();
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
