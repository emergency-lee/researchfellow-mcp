import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { resolveEntitlement } from "@/lib/entitlement";
import { SERVER_VERSION } from "@/lib/version";
import { registerPing } from "@/lib/tools/ping";
import { registerEntitlementStatus } from "@/lib/tools/entitlement-status";
import { registerNoveltyCheck } from "@/lib/tools/novelty-check";
import { registerMethodologyAdvisor } from "@/lib/tools/methodology-advisor";
import { registerJournalFit } from "@/lib/tools/journal-fit";
import { registerChecklistMap } from "@/lib/tools/checklist-review";

const handler = createMcpHandler(
  (server) => {
    registerPing(server);
    registerEntitlementStatus(server);
    registerNoveltyCheck(server);
    registerMethodologyAdvisor(server);
    registerJournalFit(server);
    registerChecklistMap(server);
  },
  {
    serverInfo: { name: "researchfellow-mcp", version: SERVER_VERSION },
    capabilities: { tools: {} },
  },
  {
    basePath: "/api", // must match the [transport] route location
    maxDuration: 60,
    verboseLogs: process.env.NODE_ENV === "development",
  },
);

// PR-2 (API-key path). §0-2 "막지 말고 얕게": `required: false` — unauthenticated
// callers are NOT rejected; they run in teaser mode. A valid key attaches an
// AuthInfo whose `extra.entitlement` unlocks full mode. OAuth 2.1 flow is P2.
const verifyToken = async (
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> => {
  const ent = resolveEntitlement(bearerToken ? `Bearer ${bearerToken}` : null);
  if (ent.mode !== "full") return undefined; // -> tools default to free/teaser
  return {
    token: bearerToken!,
    scopes: [],
    clientId: "api-key",
    extra: { entitlement: ent },
  };
};

const authHandler = withMcpAuth(handler, verifyToken, { required: false });

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
