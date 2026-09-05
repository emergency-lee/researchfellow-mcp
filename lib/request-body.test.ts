import { describe, expect, it } from "vitest";
import {
  EVENTS_JSON_MAX_BYTES,
  INVALID_JSON_JSON,
  PAYLOAD_TOO_LARGE_JSON,
  TOKEN_JSON_MAX_BYTES,
  readBoundedJson,
} from "./request-body";

const encoder = new TextEncoder();

function jsonRequest(body: string, headers?: HeadersInit): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...headersAsRecord(headers) },
    body,
  });
}

function headersAsRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers).entries());
}

function streamRequest(
  chunks: Uint8Array[],
  opts: { headers?: HeadersInit; signal?: AbortSignal; cancel?: () => void } = {},
): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel() {
      opts.cancel?.();
    },
  });
  return new Request("http://localhost/test", {
    method: "POST",
    headers: opts.headers,
    body: stream,
    duplex: "half",
    signal: opts.signal,
  } as RequestInit);
}

async function failStatus(result: Awaited<ReturnType<typeof readBoundedJson>>, status: number) {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.response.status).toBe(status);
  const text = await result.response.text();
  if (status === 413) expect(text).toBe(PAYLOAD_TOO_LARGE_JSON);
  if (status === 400) expect(text).toBe(INVALID_JSON_JSON);
  // Error bodies must not echo request bytes.
  expect(text).not.toContain("secret");
  expect(text).not.toMatch(/[\uac00-\ud7a3]/);
}

describe("readBoundedJson", () => {
  it("parses valid JSON under the byte cap", async () => {
    const result = await readBoundedJson(jsonRequest('{"consent":true}'), TOKEN_JSON_MAX_BYTES);
    expect(result).toEqual({ ok: true, value: { consent: true } });
  });

  it("accepts a body whose UTF-8 size equals the cap", async () => {
    const overhead = '{"k":""}'.length;
    const body = `{"k":"${"a".repeat(TOKEN_JSON_MAX_BYTES - overhead)}"}`;
    expect(encoder.encode(body).byteLength).toBe(TOKEN_JSON_MAX_BYTES);
    const result = await readBoundedJson(jsonRequest(body), TOKEN_JSON_MAX_BYTES);
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.value as { k: string }).k.length).toBe(TOKEN_JSON_MAX_BYTES - overhead);
  });

  it("returns 400 invalid_json for empty and malformed bodies", async () => {
    await failStatus(await readBoundedJson(jsonRequest(""), 1024), 400);
    await failStatus(await readBoundedJson(jsonRequest("{not json}"), 1024), 400);
    await failStatus(await readBoundedJson(jsonRequest('{"a":1,}'), 1024), 400);
  });

  it("returns 400 for invalid UTF-8", async () => {
    const result = await readBoundedJson(streamRequest([new Uint8Array([0xff, 0xfe, 0xfd])]), 1024);
    await failStatus(result, 400);
  });

  it("returns 413 when streamed bytes exceed the cap without Content-Length", async () => {
    const over = encoder.encode("x".repeat(64));
    const result = await readBoundedJson(streamRequest([over]), 32);
    await failStatus(result, 413);
  });

  it("returns 413 when Content-Length claims oversize even if the stream is small", async () => {
    const result = await readBoundedJson(
      streamRequest([encoder.encode("{}")], { headers: { "content-length": "99999" } }),
      32,
    );
    await failStatus(result, 413);
  });

  it("does not trust an understated Content-Length — actual stream bytes still cap", async () => {
    const over = encoder.encode("x".repeat(100));
    const result = await readBoundedJson(
      streamRequest([over], { headers: { "content-length": "10" } }),
      32,
    );
    await failStatus(result, 413);
  });

  it("counts UTF-8 bytes, not JS string length", async () => {
    // "가" is U+AC00 = 3 UTF-8 bytes; two of them plus JSON quotes exceed 5 bytes.
    const body = '"가가"';
    expect(body.length).toBe(4);
    expect(encoder.encode(body).byteLength).toBe(8);
    await failStatus(await readBoundedJson(jsonRequest(body), 5), 413);
    const one = '"가"';
    expect(encoder.encode(one).byteLength).toBe(5);
    const ok = await readBoundedJson(jsonRequest(one), 5);
    expect(ok).toEqual({ ok: true, value: "가" });
  });

  it("cancels the reader once the byte cap is crossed", async () => {
    let cancelled = false;
    const max = 16;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode("x".repeat(max + 1)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request("http://localhost/test", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    const result = await readBoundedJson(req, max);
    await failStatus(result, 413);
    expect(cancelled).toBe(true);
  });

  it("cancels a hanging stream on abort instead of waiting for more chunks", async () => {
    const ac = new AbortController();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        ac.abort();
        // never enqueue/close — cancel must unblock readBoundedJson
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request("http://localhost/test", {
      method: "POST",
      body: stream,
      duplex: "half",
      signal: ac.signal,
    } as RequestInit);
    const result = await readBoundedJson(req, 1024);
    await failStatus(result, 400);
    expect(cancelled).toBe(true);
  });

  it("never succeeds an aborted upload whose received prefix is valid JSON", async () => {
    const ac = new AbortController();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"consent":true}'));
        // leave open — more body may still be coming
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request("http://localhost/test", {
      method: "POST",
      body: stream,
      duplex: "half",
      signal: ac.signal,
    } as RequestInit);
    const pending = readBoundedJson(req, TOKEN_JSON_MAX_BYTES);
    await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    const result = await pending;
    expect(result.ok).toBe(false);
    await failStatus(result, 400);
    expect(cancelled).toBe(true);
  });

  it("swallows a rejecting abort cancel without unhandledRejection", async () => {
    const leaked: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      leaked.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const ac = new AbortController();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"consent":true}'));
        },
        cancel() {
          return Promise.reject(new Error("cancel-failed"));
        },
      });
      const req = new Request("http://localhost/test", {
        method: "POST",
        body: stream,
        duplex: "half",
        signal: ac.signal,
      } as RequestInit);
      const pending = readBoundedJson(req, TOKEN_JSON_MAX_BYTES);
      await new Promise((r) => setTimeout(r, 20));
      ac.abort();
      await failStatus(await pending, 400);
      await new Promise((r) => setImmediate(r));
      expect(leaked).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("returns 413 without waiting for a cancel that never settles", async () => {
    const max = 16;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("x".repeat(max + 1)));
      },
      cancel() {
        return new Promise(() => {
          // never settles
        });
      },
    });
    const req = new Request("http://localhost/test", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    const result = await readBoundedJson(req, max);
    await failStatus(result, 413);
  });

  it("413/400 bodies are the static constants and do not echo payload text", async () => {
    const secret = `{"note":"secret-payload-가가"}`;
    const over = await readBoundedJson(jsonRequest(secret + "x".repeat(80)), 32);
    await failStatus(over, 413);
    const bad = await readBoundedJson(jsonRequest(secret.slice(0, 10)), 1024);
    await failStatus(bad, 400);
  });

  it("exports the route caps (64KiB events, 4KiB token)", () => {
    expect(EVENTS_JSON_MAX_BYTES).toBe(65536);
    expect(TOKEN_JSON_MAX_BYTES).toBe(4096);
  });
});
