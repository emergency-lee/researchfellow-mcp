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
});
