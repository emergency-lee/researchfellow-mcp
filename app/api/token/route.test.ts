import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryNotConfiguredError } from "@/lib/db";
import { PAYLOAD_TOO_LARGE_JSON, TOKEN_JSON_MAX_BYTES } from "@/lib/request-body";
import { _resetRateLimiter } from "@/lib/rate-limit";

const { issueToken, revokeToken } = vi.hoisted(() => ({
  issueToken: vi.fn(),
  revokeToken: vi.fn(),
}));

vi.mock("@/lib/telemetry-store", () => ({
  issueToken,
  revokeToken,
}));

import { DELETE, POST } from "@/app/api/token/route";

const TOKEN = "tl_" + "c".repeat(43);
const ISSUE_BODY = { consent: true as const, plugin_version: "0.2.0" };
const REVOKE_BODY = { token: TOKEN };

let ipSeq = 0;
function nextIp(): string {
  ipSeq += 1;
  return `198.51.100.${(ipSeq % 200) + 1}`;
}

function tokenReq(
  method: "POST" | "DELETE",
  body: unknown,
  ip = nextIp(),
  init: { raw?: BodyInit; duplex?: boolean } = {},
): Request {
  const payload: BodyInit = init.raw ?? (typeof body === "string" ? body : JSON.stringify(body));
  return new Request("http://localhost/api/token", {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `${ip}, 10.0.0.1`,
    },
    body: payload,
    ...(init.duplex ? ({ duplex: "half" } as RequestInit) : {}),
  });
}

beforeEach(() => {
  _resetRateLimiter();
  issueToken.mockReset();
  revokeToken.mockReset();
  issueToken.mockResolvedValue({ token: TOKEN, issued_at: "2026-07-16T12:00:00.000Z" });
  revokeToken.mockResolvedValue({ revoked: true });
});

afterEach(() => {
  _resetRateLimiter();
});

describe("POST /api/token", () => {
  it("returns 201 with the issued token payload", async () => {
    const issued = { token: TOKEN, issued_at: "2026-07-16T12:00:00.000Z" };
    issueToken.mockResolvedValue(issued);
    const res = await POST(tokenReq("POST", ISSUE_BODY));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(issued);
    expect(issueToken).toHaveBeenCalledWith({ pluginVersion: "0.2.0" });
  });

  it("returns 400 invalid_json for a malformed body", async () => {
    const res = await POST(tokenReq("POST", "not-json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
    expect(issueToken).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request when consent is not literally true or fields are extra", async () => {
    const noConsent = await POST(tokenReq("POST", { consent: false, plugin_version: "0.2.0" }));
    expect(noConsent.status).toBe(400);
    expect(await noConsent.json()).toEqual({ error: "invalid_request" });

    const extra = await POST(
      tokenReq("POST", { consent: true, plugin_version: "0.2.0", email: "a@b.c" }),
    );
    expect(extra.status).toBe(400);
    expect(issueToken).not.toHaveBeenCalled();
  });

  it("returns 413 with static JSON when the body exceeds 4KiB", async () => {
    const res = await POST(tokenReq("POST", "x".repeat(TOKEN_JSON_MAX_BYTES + 1)));
    expect(res.status).toBe(413);
    expect(await res.text()).toBe(PAYLOAD_TOO_LARGE_JSON);
    expect(issueToken).not.toHaveBeenCalled();
  });

  it("returns 503 telemetry_not_configured when storage is unset", async () => {
    issueToken.mockRejectedValue(new TelemetryNotConfiguredError());
    const res = await POST(tokenReq("POST", ISSUE_BODY));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "telemetry_not_configured" });
  });

  it("returns 500 internal for unexpected store errors", async () => {
    issueToken.mockRejectedValue(new Error("boom"));
    const res = await POST(tokenReq("POST", ISSUE_BODY));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });

  it("rate-limits before parsing: 6th hit is 429 even with invalid JSON", async () => {
    const ip = nextIp();
    for (let i = 0; i < 5; i++) {
      expect((await POST(tokenReq("POST", ISSUE_BODY, ip))).status).toBe(201);
    }
    issueToken.mockClear();
    const limited = await POST(tokenReq("POST", "{", ip));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect(issueToken).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/token", () => {
  it("returns 200 when the token is revoked", async () => {
    revokeToken.mockResolvedValue({ revoked: true });
    const res = await DELETE(tokenReq("DELETE", REVOKE_BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: true });
    expect(revokeToken).toHaveBeenCalledWith(TOKEN);
  });

  it("returns 404 when the token is unknown", async () => {
    revokeToken.mockResolvedValue({ revoked: false });
    const res = await DELETE(tokenReq("DELETE", REVOKE_BODY));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ revoked: false });
  });

  it("returns 400 invalid_json for a malformed body", async () => {
    const res = await DELETE(tokenReq("DELETE", "<<<"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
    expect(revokeToken).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for a short token or extra fields", async () => {
    const short = await DELETE(tokenReq("DELETE", { token: "short" }));
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: "invalid_request" });

    const extra = await DELETE(tokenReq("DELETE", { token: TOKEN, reason: "x" }));
    expect(extra.status).toBe(400);
    expect(revokeToken).not.toHaveBeenCalled();
  });

  it("returns 413 with static JSON when the body exceeds 4KiB", async () => {
    const res = await DELETE(tokenReq("DELETE", "x".repeat(TOKEN_JSON_MAX_BYTES + 1)));
    expect(res.status).toBe(413);
    expect(await res.text()).toBe(PAYLOAD_TOO_LARGE_JSON);
    expect(revokeToken).not.toHaveBeenCalled();
  });

  it("returns 503 telemetry_not_configured when storage is unset", async () => {
    revokeToken.mockRejectedValue(new TelemetryNotConfiguredError());
    const res = await DELETE(tokenReq("DELETE", REVOKE_BODY));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "telemetry_not_configured" });
  });

  it("returns 500 internal for unexpected store errors", async () => {
    revokeToken.mockRejectedValue(new TypeError("oops"));
    const res = await DELETE(tokenReq("DELETE", REVOKE_BODY));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });

  it("rate-limits revoke independently of issue, before parsing", async () => {
    const ip = nextIp();
    for (let i = 0; i < 5; i++) {
      expect((await DELETE(tokenReq("DELETE", REVOKE_BODY, ip))).status).toBe(200);
    }
    revokeToken.mockClear();
    const limited = await DELETE(tokenReq("DELETE", "not-json", ip));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect(revokeToken).not.toHaveBeenCalled();

    // Same IP can still issue (different limiter key).
    const issued = await POST(tokenReq("POST", ISSUE_BODY, ip));
    expect(issued.status).toBe(201);
  });
});
