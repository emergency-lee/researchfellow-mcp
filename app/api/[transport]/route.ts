import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { NextResponse } from "next/server";
import { resolveEntitlement } from "@/lib/entitlement";
import { checkRateLimit } from "@/lib/rate-limit";
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

// Prefer Vercel-set x-real-ip; fall back to x-forwarded-for leftmost hop.
function clientIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
}

// In-memory rate-limit buckets are per serverless instance (see lib/rate-limit.ts
// header). Effective global capacity is (limit × instance count). This is a
// SECOND line of defence only — real edge defence is Vercel WAF / ops config
// outside this repo, not the in-process Map.
// 60/min matches events; tool path is the main abuse surface for unauth calls.
const MCP_RATE = { max: 60, windowMs: 60_000 } as const;
const MCP_RETRY_AFTER_SEC = String(MCP_RATE.windowMs / 1000);

async function rateLimitedHandler(req: Request): Promise<Response> {
  if (!checkRateLimit(`mcp:${clientIp(req)}`, MCP_RATE)) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": MCP_RETRY_AFTER_SEC } },
    );
  }
  return authHandler(req);
}

export { rateLimitedHandler as GET, rateLimitedHandler as POST, rateLimitedHandler as DELETE };
