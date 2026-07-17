import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetRateLimiter } from "@/lib/rate-limit";

// Isolate the transport rate-limit wiring from the full MCP stack.
const delegated = vi.hoisted(() =>
  vi.fn(async (_req: Request) => new Response("delegated", { status: 200 })),
);

vi.mock("mcp-handler", () => ({
  createMcpHandler: vi.fn(() => vi.fn(async () => new Response("inner"))),
  withMcpAuth: vi.fn(() => delegated),
}));

import { GET, POST, DELETE } from "@/app/api/[transport]/route";

function mcpReq(ip: string, via: "x-forwarded-for" | "x-real-ip" = "x-forwarded-for"): Request {
  const headers = new Headers();
  if (via === "x-real-ip") headers.set("x-real-ip", ip);
  else headers.set("x-forwarded-for", `${ip}, 10.0.0.1`);
  return new Request("http://localhost/api/mcp", { method: "POST", headers });
}

beforeEach(() => {
  _resetRateLimiter();
  delegated.mockClear();
  delegated.mockImplementation(async () => new Response("delegated", { status: 200 }));
});

afterEach(() => {
  _resetRateLimiter();
});

describe("MCP transport rateLimitedHandler", () => {
  it("exports GET/POST/DELETE as the same rateLimitedHandler", () => {
    expect(GET).toBe(POST);
    expect(POST).toBe(DELETE);
  });

  it("delegates to authHandler for the first 60 requests from one IP", async () => {
    const ip = "203.0.113.10";
    for (let i = 0; i < 60; i++) {
      const res = await POST(mcpReq(ip));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("delegated");
    }
    expect(delegated).toHaveBeenCalledTimes(60);
  });

  it("returns HTTP 429 + rate_limited body + Retry-After on the 61st hit", async () => {
    const ip = "203.0.113.11";
    for (let i = 0; i < 60; i++) {
      await POST(mcpReq(ip));
    }
    const res = await POST(mcpReq(ip));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.json()).toEqual({ error: "rate_limited" });
    // 61st must not reach authHandler
    expect(delegated).toHaveBeenCalledTimes(60);
  });

  it("prefers x-real-ip over x-forwarded-for for the rate-limit key", async () => {
    // Exhaust the real-ip bucket; x-forwarded-for alone would be a different key.
    const realIp = "198.51.100.9";
    for (let i = 0; i < 60; i++) {
      await POST(mcpReq(realIp, "x-real-ip"));
    }
    const headers = new Headers({
      "x-real-ip": realIp,
      "x-forwarded-for": "203.0.113.99",
    });
    const res = await POST(new Request("http://localhost/api/mcp", { method: "POST", headers }));
    expect(res.status).toBe(429);
  });
});
