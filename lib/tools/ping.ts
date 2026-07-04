import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { KB_VERSION, SERVER_VERSION } from "@/lib/version";
import { jsonResult, logTool } from "@/lib/tools/shared";

/** `ping` — liveness / version probe. No auth required. */
export function registerPing(server: McpServer) {
  server.registerTool(
    "ping",
    {
      title: "Ping",
      description:
        "Liveness and version probe for the ResearchFellow MCP server. No auth required.",
      inputSchema: {},
    },
    async () => {
      const startedAt = Date.now();
      const out = {
        status: "ok",
        server_version: SERVER_VERSION,
        kb_version: KB_VERSION,
      };
      logTool("ping", "n/a", startedAt);
      return jsonResult(out);
    },
  );
}
