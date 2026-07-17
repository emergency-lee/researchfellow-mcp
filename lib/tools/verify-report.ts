import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  verifyReport,
  loadPublicKeyFromEnv,
  INTEGRITY_VERSION,
  type IntegrityReport,
} from "@/lib/integrity";
import { scanForPhi, phiRejection } from "@/lib/phi-guard";
import { jsonResult, logTool } from "@/lib/tools/shared";

// FREE for everyone — trust in a signature comes from its verifiability, so
// verification is never gated. No entitlement check. Unauthenticated + public
// → structural maxes + PHI scan are mandatory (PH-1/PH-2).
//
// Manifest schema is symmetric with integrity-report.ts (field-level maxes,
// artifact_hashes key cap, .strict()). Whole-report JSON size is capped as an
// extra unauth DoS backstop.
const MANIFEST_MAX_JSON = 8_192; // bytes of JSON.stringify(manifest)
const REPORT_MAX_JSON = 16_384; // bytes of JSON.stringify(report)
const ARTIFACT_HASHES_MAX_KEYS = 100;

const artifactHashesSchema = z
  .record(z.string().max(200))
  .refine((obj) => Object.keys(obj).length <= ARTIFACT_HASHES_MAX_KEYS, {
    message: "artifact_hashes exceeds key limit",
  });

const manifestSchema = z
  .object({
    project_fingerprint: z.string().min(1).max(200),
    sap_hash: z.string().max(200).optional(),
    artifact_hashes: artifactHashesSchema.optional(),
    gate_approvals: z.array(z.string().max(80)).max(20).optional(),
    audit_event_count: z.number().int().nonnegative().optional(),
    generated_by: z.string().max(120).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (JSON.stringify(val).length > MANIFEST_MAX_JSON) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "manifest exceeds size limit" });
    }
  });

const reportSchema = z
  .object({
    manifest: manifestSchema,
    issued_at: z.string().min(1).max(40),
    key_id: z.string().max(64).optional(),
    alg: z.string().min(1).max(32),
    digest: z.string().min(1).max(128),
    signature: z.string().min(1).max(256),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (JSON.stringify(val).length > REPORT_MAX_JSON) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "report exceeds size limit" });
    }
  });

const inputSchema = {
  report: reportSchema,
};

export function registerVerifyReport(server: McpServer) {
  server.registerTool(
    "verify_report",
    {
      title: "Verify Integrity Report",
      description:
        "Check an integrity report's ed25519 digest and signature against the server's public key. " +
        "A valid result only proves that this manifest existed at issued_at and has not been altered " +
        "since; the server does not validate claim truth or any pre-issuance history (blind oracle). " +
        "Free for anyone. key_id is echoed for display only — not used for key selection or " +
        "signature verification.",
      inputSchema,
    },
    async (args) => {
      const startedAt = Date.now();

      // PH-2: unauth public tool — reject PHI without logging the payload.
      const phi = scanForPhi(args);
      if (phi) {
        logTool("verify_report", "phi_rejected", startedAt);
        return jsonResult(phiRejection(phi));
      }

      const publicKey = loadPublicKeyFromEnv();
      if (!publicKey) {
        logTool("verify_report", "not_configured", startedAt);
        return jsonResult({
          error: "verification_not_configured",
          guidance: "서버 공개키(RF_SIGNING_PUBLIC_KEY)가 설정되지 않아 검증할 수 없습니다.",
        });
      }

      const result = verifyReport(args.report as unknown as IntegrityReport, publicKey);
      logTool("verify_report", result.valid ? "valid" : "invalid", startedAt);
      return jsonResult({
        integrity_version: INTEGRITY_VERSION,
        // Echo only — not used for key selection or signature verification.
        key_id: args.report.key_id ?? null,
        ...result,
        note:
          "valid means this manifest existed at issued_at and has not been altered since. " +
          "The server does not validate the claims in the manifest or any history before issuance " +
          "(blind oracle). key_id is echoed only and is not part of the signed payload or key selection.",
      });
    },
  );
}
