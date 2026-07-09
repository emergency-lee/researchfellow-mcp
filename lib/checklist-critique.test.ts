import { describe, it, expect } from "vitest";
import { critiqueManuscript } from "@/lib/checklist-critique";

const items = (t: string, opts = {}) => critiqueManuscript({ manuscript: t, ...opts }).map((i) => i.item);

describe("critiqueManuscript", () => {
  it("flags an estimate reported without a confidence interval", () => {
    const t = "The adjusted hazard ratio was 1.4. Missing data used MICE. Sensitivity analyses done. Limitations discussed. absolute risk difference reported.";
    expect(items(t)).toContain("STROBE-16a");
  });

  it("flags a relative effect without an absolute measure", () => {
    const t = "adjusted odds ratio 2.1 (95% CI 1.5-2.9). imputation used. sensitivity analysis. unmeasured confounding discussed.";
    expect(items(t)).toContain("STROBE-16c");
  });

  it("flags missing-data handling absence", () => {
    const t = "adjusted HR 1.2 (95% CI 1.0-1.4), absolute risk difference 3%. sensitivity analysis done. limitations noted.";
    expect(items(t)).toContain("STROBE-12c");
  });

  it("flags PS weighting without balance reporting", () => {
    const t = "We used IPTW propensity weighting. adjusted HR 1.3 (95% CI 1.1-1.6). absolute risk shown. imputation used. sensitivity analysis. limitations.";
    expect(items(t)).toContain("STROBE-14a");
  });

  it("flags code use without validation when routinely collected", () => {
    const t = "Exposure identified via ICD-10 codes. adjusted HR 1.2 (95% CI 1.0-1.5). absolute risk. imputation. sensitivity analysis. limitations.";
    expect(items(t, { routinely_collected: true })).toContain("RECORD-R6");
  });

  it("flags causal language in an observational study", () => {
    const t = "Metformin caused a reduction in mortality. adjusted HR 0.8 (95% CI 0.7-0.9). absolute risk. imputation. sensitivity. limitations.";
    expect(items(t)).toContain("STROBE-20");
  });

  it("does NOT flag causal language in a randomized trial", () => {
    const t = "In this randomized trial, treatment caused a reduction. adjusted HR 0.8 (95% CI 0.7-0.9). absolute risk. imputation. sensitivity. limitations.";
    expect(items(t)).not.toContain("STROBE-20");
  });

  it("a well-reported observational manuscript yields few/no issues", () => {
    const t = [
      "We report both unadjusted and adjusted hazard ratios with 95% CI.",
      "Absolute risk difference and event rates are given.",
      "Missing data were handled with multiple imputation (MICE).",
      "Sensitivity analyses included an E-value and alternative code definitions.",
      "Limitations address unmeasured/residual confounding.",
      "ICD-10 code definitions were validated by chart review (PPV).",
    ].join(" ");
    expect(critiqueManuscript({ manuscript: t, routinely_collected: true })).toHaveLength(0);
  });

  it("sorts issues high-severity first", () => {
    const t = "adjusted odds ratio 2.0. some analysis.";
    const sev = critiqueManuscript({ manuscript: t }).map((i) => i.severity);
    expect(sev).toEqual([...sev].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a] - { high: 0, medium: 1, low: 2 }[b])));
  });

  it("ignores keywords inside HTML comments", () => {
    const t = "<!-- sensitivity analysis missing data e-value -->\nadjusted HR 1.2 (95% CI 1-1.4). absolute risk. limitations. unmeasured confounding.";
    // sensitivity + missing are only in the comment -> must still be flagged
    expect(items(t)).toEqual(expect.arrayContaining(["STROBE-12c", "STROBE-12e"]));
  });
});
