// Bounded JSON body reader for anonymous telemetry HTTP routes.
// req.json() buffers the entire payload before schema checks; this counts
// streamed UTF-8 bytes and stops at a hard cap. Content-Length is an extra
// reject when it already claims oversize — it is never the only check.

import { NextResponse } from "next/server";

export const EVENTS_JSON_MAX_BYTES = 64 * 1024;
export const TOKEN_JSON_MAX_BYTES = 4 * 1024;

/** Pre-serialized — never interpolates request bytes into the error body. */
export const PAYLOAD_TOO_LARGE_JSON = '{"error":"payload_too_large"}';
export const INVALID_JSON_JSON = '{"error":"invalid_json"}';

const STATIC_JSON_HEADERS = { "content-type": "application/json" };

export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; response: NextResponse };

export function payloadTooLargeResponse(): NextResponse {
  return new NextResponse(PAYLOAD_TOO_LARGE_JSON, {
    status: 413,
    headers: STATIC_JSON_HEADERS,
  });
}

export function invalidJsonResponse(): NextResponse {
  return new NextResponse(INVALID_JSON_JSON, {
    status: 400,
    headers: STATIC_JSON_HEADERS,
  });
}

export async function readBoundedJson(
  req: Request,
  maxBytes: number,
): Promise<BoundedJsonResult> {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("maxBytes must be a positive integer");
  }

  const declared = parseContentLength(req.headers.get("content-length"));
  if (declared !== null && declared > maxBytes) {
    // Do not await: a source cancel() that never settles must not block 413.
    cancelStream(req.body);
    return { ok: false, response: payloadTooLargeResponse() };
  }

  if (req.signal.aborted) {
    cancelStream(req.body);
    return { ok: false, response: invalidJsonResponse() };
  }

  if (!req.body) {
    return parseJsonText("");
  }

  const reader = req.body.getReader();
  const onAbort = () => {
    cancelReader(reader);
  };
  req.signal.addEventListener("abort", onAbort, { once: true });

  const buf = new Uint8Array(maxBytes);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      // cancel() often resolves the pending read with done:true. A prefix that
      // happens to be valid JSON is still an aborted upload — never succeed.
      if (req.signal.aborted) {
        cancelReader(reader);
        return { ok: false, response: invalidJsonResponse() };
      }
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      if (offset + value.byteLength > maxBytes) {
        cancelReader(reader);
        return { ok: false, response: payloadTooLargeResponse() };
      }
      buf.set(value, offset);
      offset += value.byteLength;
    }
  } catch {
    cancelReader(reader);
    return { ok: false, response: invalidJsonResponse() };
  } finally {
    req.signal.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      // cancel() already released the lock
    }
  }

  if (req.signal.aborted) {
    return { ok: false, response: invalidJsonResponse() };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(0, offset));
  } catch {
    return { ok: false, response: invalidJsonResponse() };
  }
  return parseJsonText(text);
}

function parseJsonText(text: string): BoundedJsonResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: invalidJsonResponse() };
  }
}

/** Accept a single unsigned decimal; malformed headers are ignored (stream still caps). */
function parseContentLength(raw: string | null): number | null {
  if (raw === null) return null;
  const s = raw.trim();
  if (!/^[0-9]+$/.test(s)) return null;
  if (s.length > 9) return Number.MAX_SAFE_INTEGER;
  return Number(s);
}

function cancelStream(stream: ReadableStream<Uint8Array> | null): void {
  if (!stream) return;
  try {
    void Promise.resolve(stream.cancel()).catch(() => {
      // already locked, cancelled, or closed
    });
  } catch {
    // cancel threw synchronously
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void Promise.resolve(reader.cancel()).catch(() => {
      // already cancelled, closed, or the source rejected
    });
  } catch {
    // cancel threw synchronously
  }
}
