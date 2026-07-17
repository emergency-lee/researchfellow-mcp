import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KB_VERSION } from "@/lib/version";
import { scanForPhi, phiRejection } from "@/lib/phi-guard";
import {
  signReport,
  loadPrivateKeyFromEnv,
  keyId,
  INTEGRITY_VERSION,
  type StudyManifest,
} from "@/lib/integrity";
import { entitlementOf, jsonResult, logTool, type ToolExtra } from "@/lib/tools/shared";

// Signing is the paid act; verification is free (see verify-report.ts).
// Input is a de-identified manifest of hashes + metadata — NOT the study data.
// Field maxes / key cap / .strict() match verify-report.ts (symmetric).
const MANIFEST_MAX_JSON = 8_192;
const ARTIFACT_HASHES_MAX_KEYS = 100;

const artifactHashesSchema = z
  .record(z.string().max(200))
  .refine((obj) => Object.keys(obj).length <= ARTIFACT_HASHES_MAX_KEYS, {
    message: "artifact_hashes exceeds key limit",
  });

const inputSchema = {
  manifest: z
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
    }),
};

export function registerIntegrityReport(server: McpServer) {
  server.registerTool(
    "integrity_report",
    {
      title: "Integrity Report (signed)",
      description:
        "Sign (ed25519) a de-identified study manifest (project fingerprint, artifact/SAP hashes, " +
        "gate approvals, audit event count). A signature only proves that this manifest existed at " +
        "issue time and has not been altered since; the server does not validate the claims in the " +
        "manifest or any history before issuance (blind oracle). Anyone can later check it with " +
        "verify_report (free). De-identified hashes/metadata only — never PHI. key_id is metadata " +
        "echo only — not used for key selection and not included in the signed payload.",
      inputSchema,
    },
    async (args, extra: ToolExtra) => {
      const startedAt = Date.now();
      const ent = entitlementOf(extra);

      const phi = scanForPhi(args);
      if (phi) {
        logTool("integrity_report", `${ent.mode}:phi_rejected`, startedAt);
        return jsonResult(phiRejection(phi));
      }

      if (ent.mode !== "full") {
        logTool("integrity_report", "teaser", startedAt);
        return jsonResult({
          mode: "teaser",
          kb_version: KB_VERSION,
          note: "Signing is unavailable for this connection.",
        });
      }

      const privateKey = loadPrivateKeyFromEnv();
      if (!privateKey) {
        logTool("integrity_report", "full:not_configured", startedAt);
        return jsonResult({
          error: "signing_not_configured",
          guidance: "서버 서명 키(RF_SIGNING_PRIVATE_KEY)가 설정되지 않았습니다. 인증서를 발급할 수 없습니다.",
        });
      }

      const issuedAt = new Date().toISOString();
      const report = signReport(args.manifest as StudyManifest, issuedAt, privateKey, keyId());

      logTool("integrity_report", "full", startedAt);
      return jsonResult({
        mode: "full",
        integrity_version: INTEGRITY_VERSION,
        report,
        note:
          "Share this report with your submission. Anyone can check the signature with verify_report. " +
          "A valid signature only proves this manifest existed at issued_at and has not been altered " +
          "since; the server does not validate claim truth or pre-issuance history (blind oracle). " +
          "key_id is echoed for display only — not used for key selection and not part of the signed payload.",
      });
    },
  );
}
