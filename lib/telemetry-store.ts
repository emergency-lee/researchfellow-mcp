// Telemetry persistence. The server stores only sha256(token) — never the
// plaintext (same discipline as the no-plaintext-key rule in entitlement docs;
// also avoids timing-sensitive plaintext comparisons entirely).

import { createHash, randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import type { TelemetryEvent } from "@/lib/telemetry-schema";

type SqlClient = ReturnType<typeof getSql>;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function issueToken(
  input: { pluginVersion: string },
  sql: SqlClient = getSql(),
): Promise<{ token: string; issued_at: string }> {
  const token = "tl_" + randomBytes(32).toString("base64url");
  const issuedAt = new Date().toISOString();
  await sql`
    INSERT INTO telemetry_tokens (token_hash, plugin_version, consent_at)
    VALUES (${hashToken(token)}, ${input.pluginVersion}, ${issuedAt})
  `;
  return { token, issued_at: issuedAt };
}

export async function revokeToken(
  token: string,
  sql: SqlClient = getSql(),
): Promise<{ revoked: boolean }> {
  const h = hashToken(token);
  // Erase the events (the user asked to be forgotten), keep a revoked stub so
  // the same token cannot be re-registered or reused.
  await sql`DELETE FROM telemetry_events WHERE token_hash = ${h}`;
  const rows = (await sql`
    UPDATE telemetry_tokens
    SET status = 'revoked', revoked_at = now()
    WHERE token_hash = ${h} AND status = 'active'
    RETURNING id
  `) as unknown[];
  return { revoked: rows.length > 0 };
}

export class UnknownTokenError extends Error {}

export async function insertEvents(
  token: string,
  events: TelemetryEvent[],
  sql: SqlClient = getSql(),
): Promise<{ accepted: number }> {
  const h = hashToken(token);
  const known = (await sql`
    SELECT id FROM telemetry_tokens WHERE token_hash = ${h} AND status = 'active'
  `) as unknown[];
  if (known.length === 0) throw new UnknownTokenError();

  // Single-statement batch insert via unnest (≤50 rows by schema cap).
  const projectHashes = events.map((e) => e.project_hash);
  const names = events.map((e) => e.event);
  const steps = events.map((e) => e.step);
  const entryPoints = events.map((e) => e.entry_point);
  const pluginVersions = events.map((e) => e.plugin_version);
  const schemaVersions = events.map((e) => e.schema_version);
  const clientTs = events.map((e) => e.ts);

  await sql`
    INSERT INTO telemetry_events
      (token_hash, project_hash, event, step, entry_point,
       plugin_version, schema_version, client_ts)
    SELECT ${h}, * FROM unnest(
      ${projectHashes}::text[], ${names}::text[], ${steps}::smallint[],
      ${entryPoints}::text[], ${pluginVersions}::text[],
      ${schemaVersions}::smallint[], ${clientTs}::timestamptz[]
    )
  `;
  await sql`UPDATE telemetry_tokens SET last_seen_at = now() WHERE token_hash = ${h}`;
  return { accepted: events.length };
}
