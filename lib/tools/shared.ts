import { resolveEntitlement, type Entitlement } from "@/lib/entitlement";

// mcp-handler tool callbacks receive `extra` with an optional `authInfo`.
// We stash the resolved entitlement in authInfo.extra.entitlement (see route.ts).
export interface ToolExtra {
  authInfo?: {
    token?: string;
    extra?: { entitlement?: Entitlement } & Record<string, unknown>;
  };
}

/** Read the entitlement resolved at auth time; default is free/full (everything is free). */
export function entitlementOf(extra: ToolExtra | undefined): Entitlement {
  return extra?.authInfo?.extra?.entitlement ?? resolveEntitlement(null);
}

/** Wrap a plain JSON-serialisable object as an MCP text tool result. */
export function jsonResult(obj: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
  };
}

/** PH-3-compliant log line: tool name, mode, elapsed ms. Never the payload. */
export function logTool(tool: string, mode: string, startedAt: number) {
  console.log(`[${tool}] mode=${mode} ${Date.now() - startedAt}ms`);
}
