import { describe, it, expect } from "vitest";
import { recommendMethodology } from "@/lib/methodology";

describe("recommendMethodology — primary method selection", () => {
  it("cohort + time-to-event -> Cox", () => {
    const r = recommendMethodology({ design: "cohort", outcome_type: "time_to_event" });
    expect(r.primary_method).toBe("cox_ph");
    expect(r.assumptions.join(" ")).toMatch(/proportional hazards/i);
  });

  it("cohort + time-to-event + competing risks -> Fine-Gray", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "time_to_event",
      features: { competing_risks: true },
    });
    expect(r.primary_method).toBe("fine_gray");
  });

  it("cohort + common binary outcome -> log-binomial (RR, not OR)", () => {
    const r = recommendMethodology({ design: "cohort", outcome_type: "binary" });
    expect(r.primary_method).toBe("log_binomial");
  });

  it("cohort + rare binary outcome -> logistic (OR≈RR)", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "binary",
      features: { rare_outcome: true },
    });
    expect(r.primary_method).toBe("logistic");
    expect(r.assumptions.join(" ")).toMatch(/rare/i);
  });

  it("matched case-control -> conditional logistic", () => {
    const r = recommendMethodology({
      design: "case_control",
      outcome_type: "binary",
      features: { matched: true },
    });
    expect(r.primary_method).toBe("conditional_logistic");
  });
});

describe("recommendMethodology — confounding + reporting", () => {
  it("many confounders + few events -> IPTW + SMD balance reporting", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "binary",
      features: { confounders_present: true, many_confounders_few_events: true },
    });
    expect(r.confounding_strategy).toBe("iptw");
    expect(r.reporting_items).toContain("balance_smd_table");
  });

  it("routinely-collected data pulls in RECORD reporting items", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "time_to_event",
      features: { routinely_collected: true },
    });
    expect(r.reporting_items).toEqual(expect.arrayContaining(["RECORD-R5", "RECORD-R6", "RECORD-R8"]));
    expect(r.sensitivity).toContain("alternative_code_definition");
  });

  it("missing data adds MICE + STROBE-12c", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "binary",
      features: { missing_data: true },
    });
    expect(r.sensitivity).toContain("multiple_imputation_mice");
    expect(r.reporting_items).toContain("STROBE-12c");
  });

  it("always includes an E-value sensitivity for observational designs", () => {
    const r = recommendMethodology({ design: "cohort", outcome_type: "binary" });
    expect(r.sensitivity).toContain("e_value_for_unmeasured_confounding");
  });

  it("unadjusted cohort flags confounding-by-indication as a pitfall", () => {
    const r = recommendMethodology({ design: "cohort", outcome_type: "binary" });
    expect(r.confounding_strategy).toBe("none_unadjusted_must_justify");
    expect(r.pitfalls.join(" ")).toMatch(/confounding by indication/i);
  });

  it("prediction design uses predictors, not confounders, and requires validation", () => {
    const r = recommendMethodology({ design: "prediction", outcome_type: "binary" });
    expect(r.confounding_strategy).toMatch(/prediction/);
    expect(r.reporting_items).toEqual(expect.arrayContaining(["TRIPOD-10d", "TRIPOD-16"]));
  });
});
