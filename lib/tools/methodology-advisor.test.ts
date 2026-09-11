import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  registerMethodologyAdvisor,
  parseMethodologyAdvisorInput,
  methodologyAdvisorInputSchema,
  INVALID_INPUT,
} from "@/lib/tools/methodology-advisor";
import { searchPubmedWithFallback } from "@/lib/pubmed";
import { RULES_VERSION, LOCAL_IMPLEMENTATION_SUPPORT } from "@/lib/methodology";
import { KB_VERSION } from "@/lib/version";

vi.mock("@/lib/pubmed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pubmed")>();
  return {
    ...actual,
    searchPubmedWithFallback: vi.fn(),
  };
});

const mockedSearch = vi.mocked(searchPubmedWithFallback);

type ToolHandler = (
  args: unknown,
  extra?: unknown,
) => Promise<{ content: Array<{ type: string; text: string }> }>;

function captureTool(): { name: string; config: { description?: string; inputSchema: unknown }; handler: ToolHandler } {
  const box: { name?: string; config?: { description?: string; inputSchema: unknown }; handler?: ToolHandler } = {};
  const server = {
    registerTool: (n: string, c: { description?: string; inputSchema: unknown }, h: ToolHandler) => {
      box.name = n;
      box.config = c;
      box.handler = h;
    },
  } as unknown as McpServer;
  registerMethodologyAdvisor(server);
  if (!box.name || !box.config || !box.handler) {
    throw new Error("registerMethodologyAdvisor did not register");
  }
  return { name: box.name, config: box.config, handler: box.handler };
}

const pico = {
  population: "adults with sepsis",
  exposure: "vitamin C",
  outcome: "28-day mortality",
};

function parsePayload(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe("methodology_advisor registration and contract", () => {
  afterEach(() => {
    mockedSearch.mockReset();
  });

  it("registers as methodology_advisor", () => {
    expect(captureTool().name).toBe("methodology_advisor");
  });

  it("keeps the teaser contract: method + strategy + count, not full recommendation", async () => {
    mockedSearch.mockResolvedValue({
      ok: true,
      queryUsed: "q",
      articles: [{ pmid: "1", title: "t", year: 2024, journal: "J" }],
      relaxed: false,
    });
    const { handler } = captureTool();
    const payload = parsePayload(
      await handler(
        { pico, design: "cohort" },
        { authInfo: { extra: { entitlement: { tier: "free", mode: "teaser", expiresAt: null } } } },
      ),
    );
    expect(payload.mode).toBe("teaser");
    expect(payload.kb_version).toBe(KB_VERSION);
    expect(payload.rules_version).toBe(RULES_VERSION);
    expect(typeof payload.primary_method).toBe("string");
    expect(typeof payload.confounding_strategy).toBe("string");
    expect(payload.similar_study_count).toBe(1);
    expect(payload.recommendation).toBeUndefined();
    expect(payload.precedent).toBeUndefined();
    expect(String(payload.note)).toMatch(/full mode/);
  });

  it("keeps the full contract: recommendation object + precedent", async () => {
    mockedSearch.mockResolvedValue({
      ok: true,
      queryUsed: "strict-query",
      articles: [{ pmid: "99", title: "Sepsis vitamin C", year: 2023, journal: "JAMA" }],
      relaxed: false,
    });
    const { handler } = captureTool();
    const payload = parsePayload(await handler({ pico, design: "cohort", outcome_type: "binary" }));
    expect(payload.mode).toBe("full");
    expect(payload.kb_version).toBe(KB_VERSION);
    expect(payload.rules_version).toBe(RULES_VERSION);
    expect(payload.query_used).toBe("strict-query");
    const rec = payload.recommendation as Record<string, unknown>;
    expect(rec.primary_method).toBe("log_binomial");
    expect(rec.local_implementation_support).toBe(LOCAL_IMPLEMENTATION_SUPPORT);
    expect(rec.strongest_alternative).toEqual(expect.objectContaining({ primary_method: expect.any(String) }));
    expect(Array.isArray(rec.failure_conditions)).toBe(true);
    expect(Array.isArray(rec.mandatory_diagnostics)).toBe(true);
    const precedent = payload.precedent as { similar_study_count: number; examples: Array<{ pmid: string }> };
    expect(precedent.similar_study_count).toBe(1);
    expect(precedent.examples[0].pmid).toBe("99");
  });

  it("forwards structured features into the recommendation", async () => {
    mockedSearch.mockResolvedValue({ ok: true, queryUsed: "q", articles: [], relaxed: false });
    const { handler } = captureTool();
    const payload = parsePayload(
      await handler({
        pico,
        design: "prediction",
        outcome_type: "continuous",
        features: { candidate_df: 12, independent_n: 80 },
      }),
    );
    const rec = payload.recommendation as { primary_method: string; rationale_codes: string[] };
    expect(rec.primary_method).toBe("linear_prediction_model");
    expect(rec.rationale_codes).toContain("continuous_prediction_not_logistic");
  });
});

describe("methodology_advisor input schema", () => {
  const base = { pico, design: "cohort" as const };

  it("accepts existing fields without the new aggregates", () => {
    const parsed = parseMethodologyAdvisorInput({
      ...base,
      outcome_type: "binary",
      features: { confounders_present: true, rare_outcome: true, matched: false },
      keywords: ["sepsis"],
    });
    expect(parsed.ok).toBe(true);
  });

  it("defaults outcome_type to binary", () => {
    const parsed = parseMethodologyAdvisorInput(base);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.outcome_type).toBe("binary");
  });

  it("accepts bounded group/ESS/follow-up/missingness aggregates", () => {
    const parsed = parseMethodologyAdvisorInput({
      ...base,
      outcome_type: "time_to_event",
      features: {
        independent_n: 500,
        candidate_df: 8,
        cluster_count: 12,
        exposure_groups: {
          exposed: { n: 120, events: 18, non_events: 102 },
          comparator: { n: 380, events: 40, non_events: 340 },
        },
        follow_up: { median: 180, horizon: 365, unit: "day", n_at_risk_at_horizon: 90 },
        overlap: { imbalance: true, positivity_concern: false, ess_total: 410 },
        sampling_target: "cohort_risk",
        estimand: { target: "conditional" },
        outcome_time: {
          competing_risk_target: "cause_specific_hazard",
          exposure_timing: "baseline",
          causal_horizon: "hazard",
        },
        missingness: { indicated: true, mechanism: "mar" },
      },
    });
    expect(parsed.ok).toBe(true);
  });

  it("rejects unknown raw/table input without echoing row contents", () => {
    const secret = "PATIENT-ROW-SHOULD-NOT-ECHO-ZZ9";
    const input = {
      ...base,
      raw: [{ patient_id: secret, value: 42 }],
      table: [[secret, "mrn-001"]],
    };
    const parsed = parseMethodologyAdvisorInput(input);
    expect(parsed).toEqual({ ok: false, error: "invalid_input" });
    expect(JSON.stringify(parsed)).not.toContain(secret);
    expect(JSON.stringify(parsed)).not.toContain("mrn-001");
    expect(JSON.stringify(parsed)).not.toContain("42");

    const schemaResult = methodologyAdvisorInputSchema.safeParse(input);
    expect(schemaResult.success).toBe(false);
    const blob = JSON.stringify(schemaResult);
    expect(blob).not.toContain(secret);
    expect(blob).not.toContain("mrn-001");
  });

  it("rejects patient-row shaped unknown keys under features", () => {
    const secret = "id-should-not-leak";
    const parsed = parseMethodologyAdvisorInput({
      ...base,
      features: {
        confounders_present: true,
        rows: [{ patient_id: secret }],
        patient_id: secret,
      },
    });
    expect(parsed).toEqual({ ok: false, error: "invalid_input" });
    expect(JSON.stringify(parsed)).not.toContain(secret);
  });

  it("rejects contradictory aggregate counts without echoing values", () => {
    const eventsGtN = parseMethodologyAdvisorInput({
      ...base,
      features: { exposure_groups: { exposed: { n: 10, events: 77 } } },
    });
    expect(eventsGtN).toEqual({ ok: false, error: "invalid_input" });
    expect(JSON.stringify(eventsGtN)).not.toContain("77");

    const sumGtN = parseMethodologyAdvisorInput({
      ...base,
      features: { exposure_groups: { comparator: { n: 10, events: 8, non_events: 9 } } },
    });
    expect(sumGtN).toEqual({ ok: false, error: "invalid_input" });
    expect(JSON.stringify(sumGtN)).not.toContain("8");
    expect(JSON.stringify(sumGtN)).not.toContain("9");

    const indGtTotal = parseMethodologyAdvisorInput({
      ...base,
      features: { n_total: 40, independent_n: 91 },
    });
    expect(indGtTotal).toEqual({ ok: false, error: "invalid_input" });
    expect(JSON.stringify(indGtTotal)).not.toContain("91");
    expect(JSON.stringify(indGtTotal)).not.toContain("40");
  });

  it("accepts partial group counts that do not identify totals", () => {
    const parsed = parseMethodologyAdvisorInput({
      ...base,
      features: { exposure_groups: { exposed: { events: 3 }, comparator: { n: 50 } } },
    });
    expect(parsed.ok).toBe(true);
  });

  it("rejects unbounded or identifier-like top-level keys", () => {
    expect(parseMethodologyAdvisorInput({ ...base, patients: ["a"] }).ok).toBe(false);
    expect(parseMethodologyAdvisorInput({ ...base, identifiers: ["x"] }).ok).toBe(false);
    expect(parseMethodologyAdvisorInput({ ...base, data: { n: 1 } }).ok).toBe(false);
  });

  it("handler returns invalid_input without echoing when extra keys are present", async () => {
    mockedSearch.mockResolvedValue({ ok: true, queryUsed: "q", articles: [], relaxed: false });
    const { handler } = captureTool();
    const secret = "ROW-PAYLOAD-NOT-FOR-LOG";
    const result = await handler({ pico, design: "cohort", raw: [{ id: secret }] });
    const payload = parsePayload(result);
    expect(payload).toEqual(INVALID_INPUT);
    expect(JSON.stringify(payload)).not.toContain(secret);
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("registered inputSchema is a strict object schema", () => {
    const { config } = captureTool();
    const schema = config.inputSchema as z.ZodTypeAny;
    expect(schema.safeParse({ pico, design: "cohort", sneaky: true }).success).toBe(false);
    expect(schema.safeParse({ pico, design: "cohort" }).success).toBe(true);
  });
});
