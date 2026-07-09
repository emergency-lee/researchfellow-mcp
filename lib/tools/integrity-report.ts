import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KB_VERSION, UPGRADE_URL } from "@/lib/version";
import { scanForPhi, phiRejection } from "@/lib/phi-guard";
import {
  signReport,
  loadPrivateKeyFromEnv,
  keyId,
  INTEGRITY_VERSION,
  type StudyManifest,
} from "@/lib/integrity";
import { entitlementOf, jsonResult, logTool, type ToolExtra } from "@/lib/tools/shared";

// Signing (issuing a certificate) is the paid act; verification is free
// (see verify-report.ts). Input is a de-identified manifest of hashes + metadata
// — NOT the study data itself.
const inputSchema = {
  manifest: z.object({
    project_fingerprint: z.string().min(1).max(200),
    sap_hash: z.string().max(200).optional(),
    artifact_hashes: z.record(z.string().max(200)).optional(),
    gate_approvals: z.array(z.string().max(80)).max(20).optional(),
    audit_event_count: z.number().int().nonnegative().optional(),
    generated_by: z.string().max(120).optional(),
  }),
};

export function registerIntegrityReport(server: McpServer) {
  server.registerTool(
    "integrity_report",
    {
      title: "Integrity Report (signed)",
      description:
        "Issue a signed (ed25519) integrity certificate over a de-identified study manifest " +
        "(project fingerprint, artifact/SAP hashes, gate approvals, audit event count). Anyone can later " +
        "confirm it with verify_report (free). Full tier only. De-identified hashes/metadata only — never PHI.",
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
          note: "Signing an integrity certificate requires a Per-Study Pass. Verification (verify_report) is free for anyone.",
          upgrade: {
            hint: "Per-Study Pass로 서명된 무결성 인증서를 발급하세요. 검증은 누구나 무료입니다.",
            url: UPGRADE_URL,
          },
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
        note: "Share this report with your submission. Anyone can confirm it with verify_report using the published public key.",
      });
    },
  );
}
