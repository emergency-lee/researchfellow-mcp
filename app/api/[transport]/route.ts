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
import { registerIntegrityReport } from "@/lib/tools/integrity-report";
import { registerVerifyReport } from "@/lib/tools/verify-report";
import { registerReviewerPlaybook } from "@/lib/tools/reviewer-playbook";

const handler = createMcpHandler(
  (server) => {
    registerPing(server);
    registerEntitlementStatus(server);
    registerNoveltyCheck(server);
    registerMethodologyAdvisor(server);
    registerJournalFit(server);
    registerChecklistMap(server);
    registerIntegrityReport(server);
    registerVerifyReport(server);
    registerReviewerPlaybook(server);
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

// `required: false` — unauthenticated callers are never rejected, and since
// 2026-07-16 everything resolves to full mode (see lib/entitlement.ts). A
// recognized key still attaches its entitlement for diagnostics.
const verifyToken = async (
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> => {
  if (!bearerToken) return undefined; // anonymous -> tools use the free/full default
  const ent = resolveEntitlement(`Bearer ${bearerToken}`);
  if (ent.tier === "free") return undefined; // unknown key == anonymous
  return {
    token: bearerToken,
    scopes: [],
    clientId: "api-key",
    extra: { entitlement: ent },
  };
};

const authHandler = withMcpAuth(handler, verifyToken, { required: false });

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
