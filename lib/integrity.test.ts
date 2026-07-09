import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { signReport, verifyReport, stableStringify, type StudyManifest } from "@/lib/integrity";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const otherPair = generateKeyPairSync("ed25519");

const manifest: StudyManifest = {
  project_fingerprint: "rf-proj-abc123",
  sap_hash: "sha256:deadbeef",
  artifact_hashes: { protocol: "h1", sap: "h2" },
  gate_approvals: ["gate.feasibility", "gate.protocol", "gate.qc"],
  audit_event_count: 42,
};

describe("stableStringify", () => {
  it("is order-independent", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });
});

describe("sign/verify roundtrip", () => {
  it("a freshly signed report verifies", () => {
    const report = signReport(manifest, "2026-07-09T00:00:00Z", privateKey, "k1");
    const res = verifyReport(report, publicKey);
    expect(res.valid).toBe(true);
    expect(res.digest_ok).toBe(true);
    expect(res.signature_ok).toBe(true);
  });

  it("detects a tampered manifest (digest + signature mismatch)", () => {
    const report = signReport(manifest, "2026-07-09T00:00:00Z", privateKey, "k1");
    const tampered = { ...report, manifest: { ...manifest, audit_event_count: 9999 } };
    const res = verifyReport(tampered, publicKey);
    expect(res.valid).toBe(false);
    expect(res.digest_ok).toBe(false);
  });

  it("detects a tampered signature", () => {
    const report = signReport(manifest, "2026-07-09T00:00:00Z", privateKey, "k1");
    const bad = { ...report, signature: Buffer.from("not-the-signature").toString("base64") };
    const res = verifyReport(bad, publicKey);
    expect(res.valid).toBe(false);
    expect(res.signature_ok).toBe(false);
  });

  it("fails verification under the wrong public key", () => {
    const report = signReport(manifest, "2026-07-09T00:00:00Z", privateKey, "k1");
    const res = verifyReport(report, otherPair.publicKey);
    expect(res.valid).toBe(false);
    expect(res.signature_ok).toBe(false);
  });

  it("rejects an unsupported algorithm", () => {
    const report = signReport(manifest, "2026-07-09T00:00:00Z", privateKey, "k1");
    const res = verifyReport({ ...report, alg: "hmac" as never }, publicKey);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("unsupported_alg");
  });
});
