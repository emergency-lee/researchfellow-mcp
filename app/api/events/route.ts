// Telemetry event ingestion (batch ≤50). Funnel counters only — the .strict()
// schema has no field that could carry content (structural defence, PH-1
// applied to telemetry). "Stall" is a DERIVED metric (step_entered without a
// matching step_completed), not an event. PH-3: payloads are never logged.

import { NextResponse } from "next/server";
import { TelemetryNotConfiguredError } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { EVENTS_JSON_MAX_BYTES, readBoundedJson } from "@/lib/request-body";
import { eventBatchSchema } from "@/lib/telemetry-schema";
import { insertEvents, UnknownTokenError } from "@/lib/telemetry-store";

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
}

export async function POST(req: Request) {
  if (!checkRateLimit(`events:${clientIp(req)}`, { max: 60, windowMs: 60_000 })) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const body = await readBoundedJson(req, EVENTS_JSON_MAX_BYTES);
  if (!body.ok) return body.response;
  const parsed = eventBatchSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const events = parsed.data.events;
  // One batch = one token (the plugin's queue flush guarantees this; enforcing
  // it keeps the token check to a single lookup).
  const token = events[0].token;
  if (events.some((e) => e.token !== token)) {
    return NextResponse.json({ error: "mixed_tokens" }, { status: 400 });
  }
  try {
    const result = await insertEvents(token, events);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    if (err instanceof UnknownTokenError) {
      // The client should discard its token and re-register (grace flow).
      return NextResponse.json({ error: "unknown_token" }, { status: 401 });
    }
    if (err instanceof TelemetryNotConfiguredError) {
      return NextResponse.json({ error: "telemetry_not_configured" }, { status: 503 });
    }
    console.log(`[telemetry/events] error ${err instanceof Error ? err.constructor.name : "unknown"}`);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
