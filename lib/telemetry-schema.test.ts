// The .strict() contract IS the privacy guarantee: no unknown field survives,
// no field exists that could carry content. These tests pin that down.

import { describe, expect, it } from "vitest";
import {
  eventBatchSchema,
  telemetryEventSchema,
  tokenRequestSchema,
} from "./telemetry-schema";

const VALID_EVENT = {
  token: "tl_" + "a".repeat(43),
  project_hash: "0".repeat(64),
  event: "step_entered" as const,
  step: 3,
  entry_point: "S1" as const,
  plugin_version: "0.2.0",
  schema_version: 1,
  ts: "2026-07-16T12:00:00Z",
};

describe("telemetryEventSchema", () => {
  it("accepts a well-formed event", () => {
    expect(telemetryEventSchema.safeParse(VALID_EVENT).success).toBe(true);
  });

  it("rejects unknown fields loudly instead of stripping them", () => {
    const r = telemetryEventSchema.safeParse({ ...VALID_EVENT, note: "환자 김철수" });
    expect(r.success).toBe(false);
  });

  it("rejects S0 as an entry_point (resume is session_resumed + original entry)", () => {
    const r = telemetryEventSchema.safeParse({ ...VALID_EVENT, entry_point: "S0" });
    expect(r.success).toBe(false);
  });

  it("rejects out-of-range steps and unknown event names", () => {
    expect(telemetryEventSchema.safeParse({ ...VALID_EVENT, step: 14 }).success).toBe(false);
    expect(telemetryEventSchema.safeParse({ ...VALID_EVENT, event: "chat_message" }).success).toBe(false);
  });

  it("rejects a non-hex project_hash", () => {
    const r = telemetryEventSchema.safeParse({ ...VALID_EVENT, project_hash: "my-study" });
    expect(r.success).toBe(false);
  });
});

describe("eventBatchSchema", () => {
  it("caps batches at 50 events", () => {
    const events = Array.from({ length: 51 }, () => VALID_EVENT);
    expect(eventBatchSchema.safeParse({ events }).success).toBe(false);
    expect(eventBatchSchema.safeParse({ events: events.slice(0, 50) }).success).toBe(true);
  });
});

describe("tokenRequestSchema", () => {
  it("requires consent to be literally true", () => {
    expect(tokenRequestSchema.safeParse({ consent: false, plugin_version: "0.2.0" }).success).toBe(false);
    expect(tokenRequestSchema.safeParse({ consent: true, plugin_version: "0.2.0" }).success).toBe(true);
  });
});
