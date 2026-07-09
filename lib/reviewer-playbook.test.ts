import { describe, it, expect } from "vitest";
import { anticipateObjections } from "@/lib/reviewer-playbook";

const topics = (t: string, opts = {}) => anticipateObjections({ manuscript: t, ...opts }).map((o) => o.topic);

describe("anticipateObjections", () => {
  it("raises confounding by indication when no active-comparator design is described", () => {
    expect(topics("A retrospective cohort of drug users vs non-users.")).toContain("confounding_by_indication");
  });

  it("does not raise confounding by indication for an active-comparator new-user design", () => {
    expect(topics("Active-comparator, new-user cohort with E-value sensitivity analysis.")).not.toContain(
      "confounding_by_indication",
    );
  });

  it("raises immortal time when survival + exposure-defining event and no landmark", () => {
    const t = "Cox model; exposure defined by first prescription after index date. Hazard ratio reported.";
    expect(topics(t)).toContain("immortal_time_bias");
  });

  it("does not raise immortal time when a landmark/time-dependent approach is used", () => {
    const t = "Cox model with exposure as a time-dependent covariate; first prescription defines exposure.";
    expect(topics(t)).not.toContain("immortal_time_bias");
  });

  it("raises competing risks for Kaplan-Meier with death and no competing-risk handling", () => {
    expect(topics("Cumulative incidence via Kaplan-Meier; many patients died during follow-up.")).toContain(
      "competing_risks",
    );
  });

  it("raises Table 1 p-value objection for a matched design", () => {
    expect(topics("Propensity-score matching; baseline differences tested with p-value.")).toContain("table1_pvalues");
  });

  it("raises causal overreach for observational causal language, not for a trial", () => {
    expect(topics("The drug caused lower mortality in this cohort.")).toContain("causal_overreach");
    expect(topics("In this randomized trial the drug caused lower mortality.")).not.toContain("causal_overreach");
  });

  it("sorts by likelihood, high first", () => {
    const t = "cohort of users vs non-users; single-center; the drug causes benefit; propensity matching p-value.";
    const likes = anticipateObjections({ manuscript: t }).map((o) => o.likelihood);
    const rank = { high: 0, medium: 1, low: 2 } as const;
    expect(likes).toEqual([...likes].sort((a, b) => rank[a] - rank[b]));
  });

  it("every objection carries a drafted response", () => {
    const objections = anticipateObjections({ manuscript: "cohort of users vs non-users" });
    expect(objections.length).toBeGreaterThan(0);
    expect(objections.every((o) => o.suggested_response.length > 0)).toBe(true);
  });
});
