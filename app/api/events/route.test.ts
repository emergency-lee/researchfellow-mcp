import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryNotConfiguredError } from "@/lib/db";
import { EVENTS_JSON_MAX_BYTES, PAYLOAD_TOO_LARGE_JSON } from "@/lib/request-body";
import { _resetRateLimiter } from "@/lib/rate-limit";

const { insertEvents, UnknownTokenError } = vi.hoisted(() => {
  class UnknownTokenError extends Error {}
  return { insertEvents: vi.fn(), UnknownTokenError };
});

vi.mock("@/lib/telemetry-store", () => ({
  insertEvents,
  UnknownTokenError,
}));

import { POST } from "@/app/api/events/route";

const TOKEN_A = "tl_" + "a".repeat(43);
const TOKEN_B = "tl_" + "b".repeat(43);

const EVENT = {
  token: TOKEN_A,
  project_hash: "0".repeat(64),
  event: "step_entered" as const,
  step: 3,
  entry_point: "S1" as const,
  plugin_version: "0.2.0",
  schema_version: 1,
  ts: "2026-07-16T12:00:00Z",
};

let ipSeq = 0;
function nextIp(): string {
  ipSeq += 1;
  return `203.0.113.${(ipSeq % 200) + 1}`;
}

function eventsReq(
  body: unknown,
  ip = nextIp(),
  init: { headers?: Record<string, string>; raw?: BodyInit; duplex?: boolean } = {},
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    "x-forwarded-for": `${ip}, 10.0.0.1`,
    ...init.headers,
  });
  const payload: BodyInit = init.raw ?? (typeof body === "string" ? body : JSON.stringify(body));
  return new Request("http://localhost/api/events", {
    method: "POST",
    headers,
    body: payload,
    ...(init.duplex ? ({ duplex: "half" } as RequestInit) : {}),
  });
}

beforeEach(() => {
  _resetRateLimiter();
  insertEvents.mockReset();
  insertEvents.mockResolvedValue({ accepted: 1 });
});

afterEach(() => {
  _resetRateLimiter();
});

describe("POST /api/events", () => {
  it("returns 202 and accepted count for a valid single-token batch", async () => {
    insertEvents.mockResolvedValue({ accepted: 2 });
    const res = await POST(eventsReq({ events: [EVENT, { ...EVENT, step: 4 }] }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 2 });
    expect(insertEvents).toHaveBeenCalledTimes(1);
    expect(insertEvents.mock.calls[0][0]).toBe(TOKEN_A);
    expect(insertEvents.mock.calls[0][1]).toHaveLength(2);
  });

  it("returns 400 invalid_json for a malformed body", async () => {
    const res = await POST(eventsReq("{"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
    expect(insertEvents).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for schema violations (strict, empty, extra field)", async () => {
    const extra = await POST(eventsReq({ events: [{ ...EVENT, note: "환자" }] }));
    expect(extra.status).toBe(400);
    expect(await extra.json()).toEqual({ error: "invalid_request" });

    const empty = await POST(eventsReq({ events: [] }));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "invalid_request" });

    const unknownTop = await POST(eventsReq({ events: [EVENT], leaked: true }));
    expect(unknownTop.status).toBe(400);
    expect(insertEvents).not.toHaveBeenCalled();
  });

  it("returns 400 mixed_tokens when a batch carries more than one token", async () => {
    const res = await POST(
      eventsReq({ events: [EVENT, { ...EVENT, token: TOKEN_B }] }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "mixed_tokens" });
    expect(insertEvents).not.toHaveBeenCalled();
  });

  it("returns 401 unknown_token when the store rejects the token", async () => {
    insertEvents.mockRejectedValue(new UnknownTokenError());
    const res = await POST(eventsReq({ events: [EVENT] }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unknown_token" });
  });

  it("returns 503 telemetry_not_configured when storage is unset", async () => {
    insertEvents.mockRejectedValue(new TelemetryNotConfiguredError());
    const res = await POST(eventsReq({ events: [EVENT] }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "telemetry_not_configured" });
  });

  it("returns 500 internal for unexpected store errors without echoing the body", async () => {
    insertEvents.mockRejectedValue(new Error("disk-full"));
    const res = await POST(eventsReq({ events: [EVENT] }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });

  it("returns 413 with static JSON when the body exceeds 64KiB", async () => {
    const over = "x".repeat(EVENTS_JSON_MAX_BYTES + 1);
    const res = await POST(eventsReq(over));
    expect(res.status).toBe(413);
    expect(await res.text()).toBe(PAYLOAD_TOO_LARGE_JSON);
    expect(insertEvents).not.toHaveBeenCalled();
  });

  it("returns 413 from streamed bytes even without Content-Length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = new TextEncoder().encode("x".repeat(16 * 1024));
        for (let i = 0; i < 5; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const ip = nextIp();
    const res = await POST(
      eventsReq(null, ip, { raw: stream, duplex: true }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
    expect(insertEvents).not.toHaveBeenCalled();
  });

  it("rate-limits before parsing: 61st hit is 429 even with invalid JSON", async () => {
    const ip = nextIp();
    for (let i = 0; i < 60; i++) {
      const res = await POST(eventsReq({ events: [EVENT] }, ip));
      expect(res.status).toBe(202);
    }
    insertEvents.mockClear();
    const limited = await POST(eventsReq("{not-json", ip));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect(insertEvents).not.toHaveBeenCalled();
  });

  it("keys the limiter on the leftmost x-forwarded-for hop", async () => {
    const ip = nextIp();
    for (let i = 0; i < 60; i++) {
      await POST(eventsReq({ events: [EVENT] }, ip));
    }
    const same = await POST(eventsReq({ events: [EVENT] }, ip));
    expect(same.status).toBe(429);
    const other = await POST(eventsReq({ events: [EVENT] }, nextIp()));
    expect(other.status).toBe(202);
  });
});
