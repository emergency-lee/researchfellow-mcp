import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, _resetRateLimiter } from "./rate-limit";

afterEach(() => {
  _resetRateLimiter();
  vi.useRealTimers();
});

describe("checkRateLimit", () => {
  it("allows up to max within the window, then blocks", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("k", { max: 5, windowMs: 60_000 })).toBe(true);
    }
    expect(checkRateLimit("k", { max: 5, windowMs: 60_000 })).toBe(false);
  });

  it("resets after the window elapses", () => {
    vi.useFakeTimers();
    expect(checkRateLimit("k", { max: 1, windowMs: 1_000 })).toBe(true);
    expect(checkRateLimit("k", { max: 1, windowMs: 1_000 })).toBe(false);
    vi.advanceTimersByTime(1_001);
    expect(checkRateLimit("k", { max: 1, windowMs: 1_000 })).toBe(true);
  });

  it("tracks keys independently", () => {
    expect(checkRateLimit("a", { max: 1, windowMs: 60_000 })).toBe(true);
    expect(checkRateLimit("b", { max: 1, windowMs: 60_000 })).toBe(true);
  });

  // Mirrors app/api/[transport]/route.ts: mcp:${ip} @ 60/min.
  // Route returns { error: "rate_limited" } 429 when this returns false.
  it("blocks the MCP tool-path key after max hits in the window", () => {
    const key = "mcp:203.0.113.10";
    const opts = { max: 60, windowMs: 60_000 };
    for (let i = 0; i < 60; i++) {
      expect(checkRateLimit(key, opts)).toBe(true);
    }
    expect(checkRateLimit(key, opts)).toBe(false);
    // Other IPs remain independent (per-IP isolation).
    expect(checkRateLimit("mcp:198.51.100.1", opts)).toBe(true);
  });
});
