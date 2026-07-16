import { describe, expect, it } from "vitest";
import { insertEvents, issueToken, revokeToken, UnknownTokenError } from "./telemetry-store";
import type { TelemetryEvent } from "./telemetry-schema";

/** Records every query; returns scripted rows per call index. */
function fakeSql(results: unknown[][] = []) {
  const queries: { text: string; values: unknown[] }[] = [];
  let call = 0;
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join("?"), values });
    return Promise.resolve(results[call++] ?? []);
  };
  return { tag: tag as never, queries };
}

const EVENT: TelemetryEvent = {
  token: "tl_" + "a".repeat(43),
  project_hash: "0".repeat(64),
  event: "step_entered",
  step: 3,
  entry_point: "S1",
  plugin_version: "0.2.0",
  schema_version: 1,
  ts: "2026-07-16T12:00:00Z",
};

describe("issueToken", () => {
  it("returns a tl_ token but stores only its hash", async () => {
    const { tag, queries } = fakeSql();
    const issued = await issueToken({ pluginVersion: "0.2.0" }, tag);
    expect(issued.token.startsWith("tl_")).toBe(true);
    const blob = JSON.stringify(queries);
    expect(blob).not.toContain(issued.token);          // plaintext never reaches SQL
    expect(queries[0].values[0]).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });
});

describe("insertEvents", () => {
  it("rejects an unknown/revoked token", async () => {
    const { tag } = fakeSql([[]]); // token lookup returns no rows
    await expect(insertEvents(EVENT.token, [EVENT], tag)).rejects.toBeInstanceOf(UnknownTokenError);
  });

  it("batch-inserts under the token hash, never the plaintext", async () => {
    const { tag, queries } = fakeSql([[{ id: 1 }], [], []]);
    const result = await insertEvents(EVENT.token, [EVENT, { ...EVENT, step: 4 }], tag);
    expect(result.accepted).toBe(2);
    expect(JSON.stringify(queries)).not.toContain(EVENT.token);
  });
});

describe("revokeToken", () => {
  it("deletes events and marks the token revoked", async () => {
    const { tag, queries } = fakeSql([[], [{ id: 1 }]]);
    const result = await revokeToken(EVENT.token, tag);
    expect(result.revoked).toBe(true);
    expect(queries[0].text).toContain("DELETE FROM telemetry_events");
    expect(queries[1].text).toContain("status = 'revoked'");
  });

  it("reports revoked:false for an unknown token", async () => {
    const { tag } = fakeSql([[], []]);
    const result = await revokeToken(EVENT.token, tag);
    expect(result.revoked).toBe(false);
  });
});
