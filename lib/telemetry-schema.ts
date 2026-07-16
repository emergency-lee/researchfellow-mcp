// Telemetry input schemas. EVERY schema is .strict(): a field that could carry
// content does not exist here, and any unknown field is rejected loudly with a
// 400 instead of being silently stripped (structural defence — same philosophy
// as PH-1, applied to telemetry; also the lesson from the zod-strip finding in
// docs/roadmap_2026-07-16.md §2.3).

import { z } from "zod";

export const TELEMETRY_EVENTS = [
  "project_created",
  "entry_point_selected",
  "step_entered",
  "step_completed",
  "gate_approved",
  "gate_rejected",
  "gate_changes_requested",
  "session_resumed",
] as const;

// S0 is deliberately absent: resuming is the `session_resumed` event carrying
// the project's ORIGINAL entry point — "S0" is never a value of entry_point.
export const ENTRY_POINTS = ["S1", "S2", "S3", "S4", "S5"] as const;

export const tokenRequestSchema = z
  .object({
    consent: z.literal(true),
    plugin_version: z.string().min(1).max(40),
  })
  .strict();

export const tokenRevokeSchema = z
  .object({
    token: z.string().min(20).max(128),
  })
  .strict();

export const telemetryEventSchema = z
  .object({
    token: z.string().min(20).max(128),
    project_hash: z.string().regex(/^[0-9a-f]{64}$/),
    event: z.enum(TELEMETRY_EVENTS),
    step: z.number().int().min(1).max(13).nullable(),
    entry_point: z.enum(ENTRY_POINTS).nullable(),
    plugin_version: z.string().min(1).max(40),
    schema_version: z.number().int().min(1).max(100),
    ts: z.string().datetime(),
  })
  .strict();

export const eventBatchSchema = z
  .object({
    events: z.array(telemetryEventSchema).min(1).max(50),
  })
  .strict();

export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;
