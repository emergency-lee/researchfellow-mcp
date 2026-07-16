// Entitlement resolution.
//
// 2026-07-16 policy: EVERYTHING is free — every caller (authenticated or not)
// resolves to mode "full". The Tier/Mode/UsageMeter structure is deliberately
// kept as a dormant seam: if a paid tier ever returns, DEFAULT_ENTITLEMENT is
// the single point to flip. Valid RF_API_KEYS keys still resolve to the "pass"
// tier so key-based diagnostics (entitlement_status) keep working.

export type Tier = "free" | "pass" | "pro";
export type Mode = "teaser" | "full";

export interface Entitlement {
  tier: Tier;
  mode: Mode;
  /** Tier expiry. Unused while everything is free. */
  expiresAt: string | null;
}

// Single neutralization point — flipping mode here is what "everything free"
// means; the per-tool teaser branches become unreachable dead code.
const DEFAULT_ENTITLEMENT: Entitlement = { tier: "free", mode: "full", expiresAt: null };

function validKeys(): Set<string> {
  const raw = process.env.RF_API_KEYS ?? "";
  return new Set(
    raw
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  );
}

function extractBearer(authHeader?: string | null): string | undefined {
  if (!authHeader) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1].trim() : undefined;
}

/**
 * Resolve entitlement from an Authorization header value.
 * Never throws; absent/unknown keys resolve to the free/full default.
 */
export function resolveEntitlement(authHeader?: string | null): Entitlement {
  const key = extractBearer(authHeader);
  if (key && validKeys().has(key)) {
    return { tier: "pass", mode: "full", expiresAt: null };
  }
  return DEFAULT_ENTITLEMENT;
}

// ---------------------------------------------------------------------------
// Usage metering — dormant interface (kept as the seam for a future paid tier;
// usage stats live in the telemetry layer instead, see lib/telemetry-store.ts).
// ---------------------------------------------------------------------------
export interface UsageMeter {
  /** Record one billable research-unit touch for a project fingerprint. */
  record(input: {
    projectFingerprint: string | null;
    tool: string;
    tier: Tier;
  }): Promise<void>;
}

export const usageMeter: UsageMeter = {
  async record() {
    /* no-op — dormant */
  },
};
