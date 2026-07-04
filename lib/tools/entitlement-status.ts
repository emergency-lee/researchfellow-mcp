import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { UPGRADE_URL } from "@/lib/version";
import {
  entitlementOf,
  jsonResult,
  logTool,
  type ToolExtra,
} from "@/lib/tools/shared";

/** `entitlement_status` — report the caller's current tier / mode. */
export function registerEntitlementStatus(server: McpServer) {
  server.registerTool(
    "entitlement_status",
    {
      title: "Entitlement Status",
      description:
        "Report the current API key's tier and mode. Unauthenticated callers see free/teaser plus a (non-forcing) upgrade hint.",
      inputSchema: {},
    },
    async (_args: Record<string, never>, extra: ToolExtra) => {
      const startedAt = Date.now();
      const ent = entitlementOf(extra);
      const out: Record<string, unknown> = {
        tier: ent.tier,
        mode: ent.mode,
        expires_at: ent.expiresAt, // stub: null until billing store (P1.5)
      };
      // PR-6: teaser callers get an upgrade hint, but it is never forced.
      if (ent.mode === "teaser") {
        out.upgrade = {
          hint: "Per-Study Pass로 novelty_check full 결과(유사 논문 목록·포지셔닝 제안)를 해제하세요.",
          url: UPGRADE_URL,
        };
      }
      logTool("entitlement_status", ent.mode, startedAt);
      return jsonResult(out);
    },
  );
}
