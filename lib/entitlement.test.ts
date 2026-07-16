import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveEntitlement } from "@/lib/entitlement";

const ORIGINAL = process.env.RF_API_KEYS;

describe("resolveEntitlement (everything free — 2026-07-16 policy)", () => {
  beforeEach(() => {
    process.env.RF_API_KEYS = "key-alpha, key-beta";
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.RF_API_KEYS;
    else process.env.RF_API_KEYS = ORIGINAL;
  });

  it("absent auth -> free/full (never rejected, never shallow)", () => {
    expect(resolveEntitlement(null)).toMatchObject({ tier: "free", mode: "full" });
  });

  it("unknown key -> free/full", () => {
    expect(resolveEntitlement("Bearer not-a-real-key")).toMatchObject({ tier: "free", mode: "full" });
  });

  it("valid key -> pass/full (dormant tier seam kept for diagnostics)", () => {
    expect(resolveEntitlement("Bearer key-alpha")).toMatchObject({ tier: "pass", mode: "full" });
  });

  it("is case-insensitive on the Bearer scheme and trims the key", () => {
    expect(resolveEntitlement("bearer   key-beta  ")).toMatchObject({ tier: "pass", mode: "full" });
  });

  it("a malformed header degrades to the default, not throws", () => {
    expect(() => resolveEntitlement("Basic abc")).not.toThrow();
    expect(resolveEntitlement("Basic abc")).toMatchObject({ tier: "free", mode: "full" });
  });
});
