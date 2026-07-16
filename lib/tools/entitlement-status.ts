import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  entitlementOf,
  jsonResult,
  logTool,
  type ToolExtra,
} from "@/lib/tools/shared";

/** `entitlement_status` — diagnostic: report the caller's resolved tier/mode.
 *  All tools respond in full mode for every caller; this exists so key-based
 *  setups can confirm what the server resolved for them. */
export function registerEntitlementStatus(server: McpServer) {
  server.registerTool(
    "entitlement_status",
    {
      title: "Entitlement Status",
      description:
        "Diagnostic: report the tier and mode the server resolved for this connection. " +
        "All tools return full results for every caller.",
      inputSchema: {},
    },
    async (_args: Record<string, never>, extra: ToolExtra) => {
      const startedAt = Date.now();
      const ent = entitlementOf(extra);
      logTool("entitlement_status", ent.mode, startedAt);
      return jsonResult({
        tier: ent.tier,
        mode: ent.mode,
        expires_at: ent.expiresAt,
      });
    },
  );
}
