import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  verifyReport,
  loadPublicKeyFromEnv,
  INTEGRITY_VERSION,
  type IntegrityReport,
} from "@/lib/integrity";
import { jsonResult, logTool } from "@/lib/tools/shared";

// FREE for everyone — trust in a certificate comes from its verifiability, so
// verification is never gated. No entitlement check.
const inputSchema = {
  report: z.object({
    manifest: z.record(z.unknown()),
    issued_at: z.string(),
    key_id: z.string().optional(),
    alg: z.string(),
    digest: z.string(),
    signature: z.string(),
  }),
};

export function registerVerifyReport(server: McpServer) {
  server.registerTool(
    "verify_report",
    {
      title: "Verify Integrity Report",
      description:
        "Verify a previously issued integrity report against the server's published ed25519 public key. " +
        "Free for anyone — a certificate is only trustworthy because it is verifiable. Returns whether the " +
        "digest and signature match.",
      inputSchema,
    },
    async (args) => {
      const startedAt = Date.now();

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
        key_id: args.report.key_id ?? null,
        ...result,
      });
    },
  );
}
