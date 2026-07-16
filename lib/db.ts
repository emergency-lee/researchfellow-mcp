// Neon Postgres client (telemetry only — see migrations/001_telemetry.sql).
// The MCP tool layer stays stateless; only the telemetry HTTP routes touch the DB.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export class TelemetryNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not set — telemetry storage is not configured");
  }
}

let cached: NeonQueryFunction<false, false> | null = null;

export function getSql(): NeonQueryFunction<false, false> {
  // The Vercel Neon marketplace integration injects POSTGRES_URL (and
  // DATABASE_URL in some environments) — accept either.
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new TelemetryNotConfiguredError();
  if (!cached) cached = neon(url);
  return cached;
}
