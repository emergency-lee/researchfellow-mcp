import { describe, it, expect } from "vitest";
import { scoreJournals, abstractDiagnostics } from "@/lib/journals";

describe("scoreJournals", () => {
  it("ranks a sepsis/ICU study toward Critical Care Medicine", () => {
    const ranked = scoreJournals({
      abstract: "Among adults with sepsis in the ICU requiring mechanical ventilation, mortality was assessed.",
      keywords: ["shock"],
      design: "cohort",
    });
    expect(ranked[0].name).toBe("Critical Care Medicine");
    expect(ranked[0].matched_scope).toEqual(expect.arrayContaining(["sepsis", "icu"]));
    expect(ranked[0].design_match).toBe(true);
  });

  it("ranks a diabetes study toward Diabetes Care", () => {
    const ranked = scoreJournals({
      abstract: "Metformin and glycemic control among patients with diabetes and insulin use.",
    });
    expect(ranked[0].name).toBe("Diabetes Care");
  });

  it("gives a design-match bonus", () => {
    const withDesign = scoreJournals({ abstract: "cardiovascular myocardial infarction stroke", design: "prediction" });
    const circ = withDesign.find((r) => r.name === "Circulation")!;
    expect(circ.design_match).toBe(true);
    expect(circ.score).toBeGreaterThan(0);
  });

  it("returns zero-score candidates for an off-scope abstract", () => {
    const ranked = scoreJournals({ abstract: "a study about nothing in particular xyzzy" });
    expect(ranked.every((r) => r.score >= 0)).toBe(true);
    expect(ranked[0].score).toBe(0);
  });
});

describe("abstractDiagnostics", () => {
  it("flags a missing structured-abstract label", () => {
    const d = abstractDiagnostics("Background: x. Methods: y. Results: z.", "New England Journal of Medicine")!;
    expect(d.missing_labels).toContain("Conclusions");
    expect(d.expected_format).toMatch(/Background\/Methods\/Results\/Conclusions/);
  });

  it("checks the word limit", () => {
    const longAbstract = Array(300).fill("word").join(" ");
    const d = abstractDiagnostics(longAbstract, "New England Journal of Medicine")!;
    expect(d.word_count).toBe(300);
    expect(d.within_limit).toBe(false);
  });

  it("returns null for an unknown journal", () => {
    expect(abstractDiagnostics("x", "Nonexistent Journal")).toBeNull();
  });
});
