// Deep reporting critique (server-side depth counterpart to the plugin's free
// checklist_map.py coverage screen). The free local check answers "is item X
// mentioned?"; this answers "given X is present, does it meet its sub-
// requirements?" — deterministic, actionable, still no LLM required.

export const CRITIQUE_VERSION = "critique-rules-v1";

export type Severity = "high" | "medium" | "low";

export interface CritiqueIssue {
  item: string;
  severity: Severity;
  message: string;
  suggestion: string;
}

interface Rule {
  item: string;
  severity: Severity;
  // Fires an issue when `applies` is true but `satisfied` is false.
  applies: (t: string, rc: boolean) => boolean;
  satisfied: (t: string) => boolean;
  message: string;
  suggestion: string;
}

const has = (re: RegExp) => (t: string) => re.test(t);

const RE = {
  estimate: /(hazard ratio|odds ratio|risk ratio|\bhr\b|\bor\b|\brr\b)/,
  ci: /(95\s?%?\s?ci|confidence interval|\bci\b)/,
  adjusted: /adjust/,
  absolute: /(absolute risk|risk difference|event rate|incidence|per 1000|per 100 )/,
  missing: /(missing data|imputation|complete[- ]case|mice)/,
  sensitivity: /(sensitivity analys|e-value|negative control|alternative (code )?definition)/,
  unmeasured: /(unmeasured confounding|residual confounding)/,
  limitation: /limitation/,
  ps: /(propensity|iptw|inverse probability|weighting|matching)/,
  balance: /(standardized mean difference|standardised mean difference|\bsmd\b|covariate balance)/,
  codes: /(icd-?\d|\batc\b|\bcpt\b|diagnosis cod|procedure cod)/,
  validation: /(validat|positive predictive value|\bppv\b|chart review)/,
  causal: /\b(caused|causes|causal effect|caused by)\b/,
  trial: /(randomi[sz]ed|randomly assigned|\brct\b)/,
};

const RULES: Rule[] = [
  {
    item: "STROBE-16a",
    severity: "high",
    applies: has(RE.estimate),
    satisfied: has(RE.ci),
    message: "An effect estimate is reported without a confidence interval.",
    suggestion: "Report every estimate with its 95% CI (STROBE-16a).",
  },
  {
    item: "STROBE-16a",
    severity: "medium",
    applies: has(RE.estimate),
    satisfied: has(RE.adjusted),
    message: "An effect estimate appears without a confounder-adjusted version.",
    suggestion: "Report both unadjusted and adjusted estimates (STROBE-16a).",
  },
  {
    item: "STROBE-16c",
    severity: "medium",
    applies: has(RE.estimate),
    satisfied: has(RE.absolute),
    message: "A relative effect is reported without an absolute measure.",
    suggestion: "Add absolute risk / risk difference alongside the relative effect (STROBE-16c).",
  },
  {
    item: "STROBE-12c",
    severity: "high",
    applies: () => true,
    satisfied: has(RE.missing),
    message: "Missing-data handling is not described.",
    suggestion: "State how missing data were handled (complete-case vs multiple imputation) (STROBE-12c).",
  },
  {
    item: "STROBE-12e",
    severity: "medium",
    applies: () => true,
    satisfied: has(RE.sensitivity),
    message: "No sensitivity analysis is described.",
    suggestion: "Add a sensitivity analysis (E-value, alternative definitions, negative controls) (STROBE-12e).",
  },
  {
    item: "STROBE-19",
    severity: "high",
    applies: () => true,
    satisfied: (t) => RE.unmeasured.test(t) || RE.limitation.test(t),
    message: "Limitations / unmeasured confounding are not addressed.",
    suggestion: "Add a limitations paragraph explicitly addressing unmeasured/residual confounding (STROBE-19).",
  },
  {
    item: "STROBE-14a",
    severity: "medium",
    applies: has(RE.ps),
    satisfied: has(RE.balance),
    message: "Propensity-score matching/weighting is used but covariate balance is not reported.",
    suggestion: "Report standardized mean differences (SMD < 0.1) instead of p-values for balance (STROBE-14a).",
  },
  {
    item: "RECORD-R6",
    severity: "high",
    applies: (t, rc) => rc || RE.codes.test(t),
    satisfied: has(RE.validation),
    message: "Diagnosis/procedure codes are used without any code validation.",
    suggestion: "Report validation of code-based definitions (PPV / chart review) (RECORD-R6).",
  },
  {
    item: "STROBE-20",
    severity: "high",
    applies: (t) => RE.causal.test(t) && !RE.trial.test(t),
    satisfied: () => false, // if causal language in an observational study, always flag
    message: "Causal language is used for an observational (non-randomized) design.",
    suggestion: "Use association language, or justify a formal causal design (e.g. target-trial emulation) (STROBE-20).",
  },
];

export interface CritiqueInput {
  manuscript: string;
  design?: string;
  routinely_collected?: boolean;
}

export function critiqueManuscript(input: CritiqueInput): CritiqueIssue[] {
  // Strip HTML comments so template anchors don't satisfy a rule (mirrors the
  // plugin's coverage screen).
  const text = input.manuscript.replace(/<!--[\s\S]*?-->/g, " ").toLowerCase();
  const rc = Boolean(input.routinely_collected);
  const issues: CritiqueIssue[] = [];
  for (const rule of RULES) {
    if (rule.applies(text, rc) && !rule.satisfied(text)) {
      issues.push({
        item: rule.item,
        severity: rule.severity,
        message: rule.message,
        suggestion: rule.suggestion,
      });
    }
  }
  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
