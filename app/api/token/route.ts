// Telemetry token issuance / revocation. Plain HTTP (not an MCP tool) on
// purpose: telemetry must work for users who never configure .mcp.json — the
// plugin's telemetry.py calls this directly with stdlib urllib (FR-T7 network
// exception #2). PH-3: request bodies are never logged.

import { NextResponse } from "next/server";
import { TelemetryNotConfiguredError } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { readBoundedJson, TOKEN_JSON_MAX_BYTES } from "@/lib/request-body";
import { tokenRequestSchema, tokenRevokeSchema } from "@/lib/telemetry-schema";
import { issueToken, revokeToken } from "@/lib/telemetry-store";

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
}

function errorResponse(err: unknown): NextResponse {
  if (err instanceof TelemetryNotConfiguredError) {
    return NextResponse.json({ error: "telemetry_not_configured" }, { status: 503 });
  }
  console.log(`[telemetry/token] error ${err instanceof Error ? err.constructor.name : "unknown"}`);
  return NextResponse.json({ error: "internal" }, { status: 500 });
}

export async function POST(req: Request) {
  if (!checkRateLimit(`token:${clientIp(req)}`, { max: 5, windowMs: 60_000 })) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const body = await readBoundedJson(req, TOKEN_JSON_MAX_BYTES);
  if (!body.ok) return body.response;
  const parsed = tokenRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    const issued = await issueToken({ pluginVersion: parsed.data.plugin_version });
    return NextResponse.json(issued, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request) {
  if (!checkRateLimit(`revoke:${clientIp(req)}`, { max: 5, windowMs: 60_000 })) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const body = await readBoundedJson(req, TOKEN_JSON_MAX_BYTES);
  if (!body.ok) return body.response;
  const parsed = tokenRevokeSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    const result = await revokeToken(parsed.data.token);
    return NextResponse.json(result, { status: result.revoked ? 200 : 404 });
  } catch (err) {
    return errorResponse(err);
  }
}
