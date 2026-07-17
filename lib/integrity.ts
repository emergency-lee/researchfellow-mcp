// Integrity attestation: sign a de-identified study manifest and verify it.
// A valid signature only proves that this manifest existed at issued_at and has
// not been altered since (blind oracle — claims and pre-issuance history are not
// validated). verify_report is free for anyone. Signing uses ed25519; verification
// uses RF_SIGNING_PUBLIC_KEY. key_id is stored on the report for display only —
// it is not part of the signed body and does not select keys. Pure given key
// material; the tool layer sources keys from env.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";

export const INTEGRITY_VERSION = "integrity-v1";

// Keys are sourced from env as base64-encoded PEM (env-safe, no newlines issue).
export function loadPrivateKeyFromEnv(): KeyObject | null {
  const b64 = process.env.RF_SIGNING_PRIVATE_KEY;
  if (!b64) return null;
  try {
    return createPrivateKey(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function loadPublicKeyFromEnv(): KeyObject | null {
  const b64 = process.env.RF_SIGNING_PUBLIC_KEY;
  if (!b64) return null;
  try {
    return createPublicKey(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function keyId(): string {
  return process.env.RF_SIGNING_KEY_ID ?? "rf-ed25519-1";
}

export interface StudyManifest {
  project_fingerprint: string;
  sap_hash?: string;
  artifact_hashes?: Record<string, string>;
  gate_approvals?: string[];
  audit_event_count?: number;
  generated_by?: string;
}

export interface IntegrityReport {
  manifest: StudyManifest;
  issued_at: string;
  key_id: string;
  alg: "ed25519";
  digest: string; // sha256 of the canonical signed body (hex)
  signature: string; // base64 ed25519 signature over the canonical body
}

export interface VerifyResult {
  valid: boolean;
  digest_ok: boolean;
  signature_ok: boolean;
  reason?: string;
}

/** Deterministic canonical JSON (recursively key-sorted) so the digest/signature
 *  are stable regardless of property order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** The exact bytes that are hashed and signed (manifest + issued_at). */
function signedBody(manifest: StudyManifest, issuedAt: string): string {
  return stableStringify({ manifest, issued_at: issuedAt });
}

export function signReport(
  manifest: StudyManifest,
  issuedAt: string,
  privateKey: KeyObject,
  keyId: string,
): IntegrityReport {
  const body = signedBody(manifest, issuedAt);
  const digest = sha256Hex(body);
  const signature = edSign(null, Buffer.from(body, "utf8"), privateKey).toString("base64");
  return { manifest, issued_at: issuedAt, key_id: keyId, alg: "ed25519", digest, signature };
}

export function verifyReport(report: IntegrityReport, publicKey: KeyObject): VerifyResult {
  if (report.alg !== "ed25519") {
    return { valid: false, digest_ok: false, signature_ok: false, reason: "unsupported_alg" };
  }
  const body = signedBody(report.manifest, report.issued_at);
  const digest_ok = sha256Hex(body) === report.digest;

  let signature_ok = false;
  try {
    signature_ok = edVerify(null, Buffer.from(body, "utf8"), publicKey, Buffer.from(report.signature, "base64"));
  } catch {
    signature_ok = false;
  }

  const valid = digest_ok && signature_ok;
  return {
    valid,
    digest_ok,
    signature_ok,
    reason: valid ? undefined : !digest_ok ? "digest_mismatch" : "signature_mismatch",
  };
}
