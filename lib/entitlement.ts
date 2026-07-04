// Entitlement resolution (PR-2 API-key path; PR-3 tiers).
//
// §0-2 "막지 말고 얕게": an unauthenticated / unknown key is NOT rejected — it is
// simply resolved to the `free` tier in `teaser` mode. Valid keys unlock `full`.
//
// OAuth 2.1 (PR-2 standard flow) is deferred to P2. For P1 we accept a static
// API key from `Authorization: Bearer <key>`, matched against the comma-separated
// allowlist in env `RF_API_KEYS`.

export type Tier = "free" | "pass" | "pro";
export type Mode = "teaser" | "full";

export interface Entitlement {
  tier: Tier;
  mode: Mode;
  /** Pass/Pro expiry. Stubbed to null in P1 (no billing store yet). */
  expiresAt: string | null;
}

const FREE_TEASER: Entitlement = { tier: "free", mode: "teaser", expiresAt: null };

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
 * Never throws; unknown/absent keys degrade to free/teaser.
 *
 * P1: any valid key maps to `pass`/`full`. Per-key tier lookup (pass vs pro) and
 * expiry come with the billing store (P1.5 / PR-5 Stripe entitlement sync).
 */
export function resolveEntitlement(authHeader?: string | null): Entitlement {
  const key = extractBearer(authHeader);
  if (key && validKeys().has(key)) {
    return { tier: "pass", mode: "full", expiresAt: null };
  }
  return FREE_TEASER;
}

// ---------------------------------------------------------------------------
// PR-4 Pass metering — project-fingerprint attribution.
// Interface only for P1; no-op implementation. Usage is attributed per research
// project (`.research/` UUID), NOT per tool call.
// ---------------------------------------------------------------------------
export interface UsageMeter {
  /** Record one billable research-unit touch for a project fingerprint. */
  record(input: {
    projectFingerprint: string | null;
    tool: string;
    tier: Tier;
  }): Promise<void>;
}

// TODO(P1.5 Neon): replace with a Postgres-backed meter keyed on project UUID
// (PR-4). P1 is stateless — no DB/redis — so metering is a no-op here.
export const usageMeter: UsageMeter = {
  async record() {
    /* no-op in P1 */
  },
};
