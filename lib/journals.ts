// Curated journal knowledge base + fit scoring (server-side value for
// journal_fit). Pure + testable. Scope keywords are lowercased; matching is
// substring on the lowercased manuscript text so multiword phrases work.

export const JOURNAL_KB_VERSION = "journal-kb-v1";

export interface Journal {
  name: string;
  tier: "general_top" | "general" | "specialty";
  scope: string[];
  designs: string[];
  abstractFormat: string;
  abstractWordLimit: number;
}

// Representative venues only — enough to demonstrate fit, not exhaustive.
export const JOURNALS: Journal[] = [
  { name: "New England Journal of Medicine", tier: "general_top",
    scope: ["clinical trial", "mortality", "cardiovascular", "oncology", "infectious disease", "practice-changing", "internal medicine"],
    designs: ["cohort", "case_control"], abstractFormat: "Background/Methods/Results/Conclusions", abstractWordLimit: 250 },
  { name: "JAMA", tier: "general_top",
    scope: ["clinical trial", "epidemiology", "health policy", "internal medicine", "mortality", "comparative effectiveness"],
    designs: ["cohort", "case_control", "cross_sectional"], abstractFormat: "Importance/Objective/Design/Setting/Participants/Exposures/Outcomes/Results/Conclusions", abstractWordLimit: 350 },
  { name: "The Lancet", tier: "general_top",
    scope: ["global health", "clinical trial", "mortality", "public health", "cardiovascular", "infectious disease"],
    designs: ["cohort"], abstractFormat: "Background/Methods/Findings/Interpretation/Funding", abstractWordLimit: 300 },
  { name: "Annals of Internal Medicine", tier: "general_top",
    scope: ["internal medicine", "screening", "guidelines", "comparative effectiveness", "primary care", "diagnostic"],
    designs: ["cohort", "cross_sectional", "prediction"], abstractFormat: "Background/Objective/Design/Setting/Patients/Measurements/Results/Limitations/Conclusion", abstractWordLimit: 300 },
  { name: "BMJ", tier: "general",
    scope: ["epidemiology", "public health", "primary care", "observational", "routinely collected", "health services"],
    designs: ["cohort", "case_control", "cross_sectional"], abstractFormat: "Objectives/Design/Setting/Participants/Outcomes/Results/Conclusions", abstractWordLimit: 400 },
  { name: "JAMA Internal Medicine", tier: "general",
    scope: ["internal medicine", "medication safety", "health services", "overuse", "mortality", "comparative effectiveness"],
    designs: ["cohort", "cross_sectional"], abstractFormat: "Importance/Objective/Design/Participants/Exposures/Outcomes/Results/Conclusions", abstractWordLimit: 350 },
  { name: "Circulation", tier: "specialty",
    scope: ["cardiovascular", "heart failure", "myocardial infarction", "arrhythmia", "stroke", "hypertension"],
    designs: ["cohort", "prediction"], abstractFormat: "Background/Methods/Results/Conclusions", abstractWordLimit: 250 },
  { name: "Critical Care Medicine", tier: "specialty",
    scope: ["sepsis", "icu", "critical care", "mechanical ventilation", "shock", "mortality"],
    designs: ["cohort", "case_control"], abstractFormat: "Objectives/Design/Setting/Patients/Interventions/Measurements/Results/Conclusions", abstractWordLimit: 300 },
  { name: "Diabetes Care", tier: "specialty",
    scope: ["diabetes", "glycemic", "insulin", "metformin", "cardiovascular", "endocrinology"],
    designs: ["cohort", "prediction"], abstractFormat: "Objective/Research Design and Methods/Results/Conclusions", abstractWordLimit: 250 },
  { name: "Clinical Infectious Diseases", tier: "specialty",
    scope: ["infectious disease", "antibiotic", "antimicrobial", "sepsis", "hiv", "infection"],
    designs: ["cohort", "case_control"], abstractFormat: "Background/Methods/Results/Conclusions", abstractWordLimit: 250 },
];

export interface JournalInput {
  title?: string;
  abstract: string;
  keywords?: string[];
  design?: string;
}

export interface JournalScore {
  name: string;
  tier: Journal["tier"];
  score: number;
  matched_scope: string[];
  design_match: boolean;
  abstract_format: string;
  abstract_word_limit: number;
}

function haystack(input: JournalInput): string {
  return [input.title ?? "", input.abstract, ...(input.keywords ?? [])].join(" ").toLowerCase();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word/phrase match so e.g. scope "icu" does not match "partICUlar". */
function scopeMatches(term: string, text: string): boolean {
  return new RegExp(`\\b${escapeRegex(term)}\\b`).test(text);
}

export function scoreJournals(input: JournalInput): JournalScore[] {
  const text = haystack(input);
  const scored = JOURNALS.map((j) => {
    const matched = j.scope.filter((term) => scopeMatches(term, text));
    const topic = matched.length / j.scope.length;
    const designMatch = input.design ? j.designs.includes(input.design) : false;
    const score = Math.round((topic + (designMatch ? 0.1 : 0)) * 1000) / 1000;
    return {
      name: j.name,
      tier: j.tier,
      score,
      matched_scope: matched,
      design_match: designMatch,
      abstract_format: j.abstractFormat,
      abstract_word_limit: j.abstractWordLimit,
    };
  });
  return scored.sort((a, b) => b.score - a.score);
}

export interface AbstractDiagnostics {
  word_count: number;
  word_limit: number;
  within_limit: boolean;
  expected_format: string;
  missing_labels: string[];
}

/** Format diagnostics for the abstract against a chosen journal's conventions. */
export function abstractDiagnostics(abstract: string, journalName: string): AbstractDiagnostics | null {
  const j = JOURNALS.find((x) => x.name === journalName);
  if (!j) return null;
  const words = abstract.trim().split(/\s+/).filter(Boolean).length;
  const labels = j.abstractFormat.split("/").map((s) => s.trim());
  const lc = abstract.toLowerCase();
  const missing = labels.filter((label) => !lc.includes(label.toLowerCase()));
  return {
    word_count: words,
    word_limit: j.abstractWordLimit,
    within_limit: words <= j.abstractWordLimit,
    expected_format: j.abstractFormat,
    missing_labels: missing,
  };
}
