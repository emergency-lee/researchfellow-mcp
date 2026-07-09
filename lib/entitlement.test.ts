import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveEntitlement } from "@/lib/entitlement";

const ORIGINAL = process.env.RF_API_KEYS;

describe("resolveEntitlement (§0-2 degrade, don't reject)", () => {
  beforeEach(() => {
    process.env.RF_API_KEYS = "key-alpha, key-beta";
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.RF_API_KEYS;
    else process.env.RF_API_KEYS = ORIGINAL;
  });

  it("absent auth -> free/teaser (never rejected)", () => {
    expect(resolveEntitlement(null)).toMatchObject({ tier: "free", mode: "teaser" });
  });

  it("unknown key -> free/teaser", () => {
    expect(resolveEntitlement("Bearer not-a-real-key")).toMatchObject({ tier: "free", mode: "teaser" });
  });

  it("valid key -> pass/full", () => {
    expect(resolveEntitlement("Bearer key-alpha")).toMatchObject({ tier: "pass", mode: "full" });
  });

  it("is case-insensitive on the Bearer scheme and trims the key", () => {
    expect(resolveEntitlement("bearer   key-beta  ")).toMatchObject({ mode: "full" });
  });

  it("a malformed header degrades, not throws", () => {
    expect(() => resolveEntitlement("Basic abc")).not.toThrow();
    expect(resolveEntitlement("Basic abc").mode).toBe("teaser");
  });
});
