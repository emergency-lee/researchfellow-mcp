import { describe, it, expect } from "vitest";
import { buildQuery, buildRelaxedQuery, tokenize, similarity } from "@/lib/pubmed";

const pico = {
  population: "adults with sepsis",
  exposure: "vitamin C",
  comparator: "placebo",
  outcome: "28-day mortality",
};

describe("buildQuery", () => {
  it("AND-joins quoted PICO phrases and OR-groups keywords", () => {
    const q = buildQuery(pico, ["ICU", "shock"]);
    expect(q).toContain('"adults with sepsis"');
    expect(q).toContain(" AND ");
    expect(q).toContain('("ICU" OR "shock")');
  });

  it("omits an absent comparator", () => {
    const q = buildQuery({ population: "a", exposure: "b", outcome: "c" });
    expect(q).not.toContain('""');
  });
});

describe("buildRelaxedQuery", () => {
  it("drops generic clinical stopwords and numeric prefixes", () => {
    const q = buildRelaxedQuery(pico);
    expect(q.toLowerCase()).not.toContain("patient");
    // "28-day" -> "day" -> dropped as a generic token
    expect(q.toLowerCase()).not.toMatch(/\bday\b/);
    expect(q.toLowerCase()).toContain("sepsis");
  });
});

describe("similarity", () => {
  it("is 0 for an empty query token set", () => {
    expect(similarity(new Set(), "anything here")).toBe(0);
  });

  it("normalizes overlap by query size and is bounded in [0,1]", () => {
    const q = tokenize("sepsis vitamin mortality");
    const s = similarity(q, "Vitamin C in sepsis and mortality outcomes");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it("gives 0 when nothing overlaps", () => {
    expect(similarity(tokenize("oncology chemotherapy"), "cardiac surgery outcomes")).toBe(0);
  });
});

describe("tokenize", () => {
  it("drops stopwords and short tokens", () => {
    const t = tokenize("the a of sepsis");
    expect(t.has("sepsis")).toBe(true);
    expect(t.has("the")).toBe(false);
    expect(t.has("of")).toBe(false);
  });
});
