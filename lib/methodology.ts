// Deterministic methodology recommender (server-side depth counterpart to the
// plugin's references/methodology.md). Pure + fully testable: no I/O here. The
// tool layer (tools/methodology-advisor.ts) adds PubMed precedent + entitlement.

export const RULES_VERSION = "advisor-rules-v1";

export type Design = "cohort" | "case_control" | "cross_sectional" | "prediction";
export type OutcomeType = "binary" | "time_to_event" | "count" | "continuous";

export interface MethodFeatures {
  confounders_present?: boolean;
  many_confounders_few_events?: boolean;
  competing_risks?: boolean;
  time_varying_exposure?: boolean;
  rare_outcome?: boolean;
  missing_data?: boolean;
  routinely_collected?: boolean;
  matched?: boolean;
}

export interface MethodologyInput {
  design: Design;
  outcome_type: OutcomeType;
  features?: MethodFeatures;
}

export interface Recommendation {
  estimand_framing: string;
  primary_method: string;
  confounding_strategy: string;
  sensitivity: string[];
  reporting_items: string[];
  assumptions: string[];
  pitfalls: string[];
  caveats: string[];
}

function pickPrimaryMethod(design: Design, ot: OutcomeType, f: MethodFeatures): string {
  if (design === "prediction") {
    return ot === "time_to_event" ? "cox_prediction_model" : "logistic_prediction_model";
  }
  if (design === "case_control") {
    return f.matched ? "conditional_logistic" : "logistic";
  }
  if (design === "cross_sectional") {
    return "log_binomial"; // prevalence ratio; poisson-robust is the fallback
  }
  // cohort
  if (ot === "time_to_event") return f.competing_risks ? "fine_gray" : "cox_ph";
  if (ot === "count") return "poisson_robust";
  if (ot === "continuous") return "linear_regression";
  // binary
  return f.rare_outcome ? "logistic" : "log_binomial";
}

function pickConfoundingStrategy(design: Design, f: MethodFeatures): string {
  if (design === "prediction") return "not_applicable_prediction_uses_predictors";
  if (f.many_confounders_few_events) return "iptw";
  if (f.confounders_present) return "multivariable_or_doubly_robust";
  return "none_unadjusted_must_justify";
}

function assumptionsFor(method: string): string[] {
  const a: Record<string, string[]> = {
    cox_ph: ["proportional hazards (check Schoenfeld residuals / cox.zph)"],
    fine_gray: ["subdistribution hazard interprets cumulative incidence under competing events"],
    logistic: ["OR approximates RR only when the outcome is RARE"],
    log_binomial: ["may fail to converge; Poisson with robust SE is the fallback for RR"],
    poisson_robust: ["robust (sandwich) SE required; models a rate/risk ratio"],
    conditional_logistic: ["matched sets modelled via strata; do not break matching"],
    linear_regression: ["linearity, homoscedasticity, normal residuals"],
    cox_prediction_model: ["proportional hazards; report discrimination + calibration"],
    logistic_prediction_model: ["report discrimination (C-statistic) AND calibration"],
  };
  return a[method] ?? [];
}

function pitfallsFor(design: Design, method: string, f: MethodFeatures): string[] {
  const p: string[] = [];
  if (f.time_varying_exposure || method === "cox_ph" || method === "fine_gray") {
    p.push("immortal time bias — align time zero; use landmark or time-dependent exposure");
  }
  if (method === "iptw") p.push("positivity/overlap — inspect and trim extreme weights; report SMD balance");
  if (design !== "prediction" && !f.confounders_present) {
    p.push("unadjusted estimate — confounding by indication is the dominant threat");
  }
  return p;
}

/** Produce a methodology recommendation from a structured, de-identified spec. */
export function recommendMethodology(input: MethodologyInput): Recommendation {
  const f = input.features ?? {};
  const primary_method = pickPrimaryMethod(input.design, input.outcome_type, f);
  const confounding_strategy = pickConfoundingStrategy(input.design, f);

  const sensitivity: string[] = [];
  const reporting_items: string[] = ["STROBE-16a"];

  if (input.design !== "prediction") {
    sensitivity.push("e_value_for_unmeasured_confounding");
    sensitivity.push("negative_control_outcome");
    reporting_items.push("STROBE-16c");
    if (f.confounders_present || f.many_confounders_few_events) reporting_items.push("STROBE-12a");
  }
  if (f.many_confounders_few_events) reporting_items.push("balance_smd_table");
  if (f.missing_data) {
    sensitivity.push("multiple_imputation_mice");
    reporting_items.push("STROBE-12c");
  }
  if (f.routinely_collected) {
    sensitivity.push("alternative_code_definition");
    reporting_items.push("RECORD-R1", "RECORD-R4", "RECORD-R5", "RECORD-R6", "RECORD-R8");
  }
  reporting_items.push("STROBE-12e");
  if (input.design === "prediction") {
    reporting_items.push("TRIPOD-9", "TRIPOD-10d", "TRIPOD-16");
    sensitivity.push("internal_validation_bootstrap");
  }

  const caveats: string[] = [
    "This is a structured recommendation, not a substitute for a statistician.",
    "Confirm the estimand and pre-specify the analysis in the SAP before touching real data.",
  ];

  return {
    estimand_framing:
      "Frame as a target trial: define eligibility + time zero, exposure strategies, comparator " +
      "(prefer active-comparator new-user), outcome window, and the contrast measure before choosing the model.",
    primary_method,
    confounding_strategy,
    sensitivity: [...new Set(sensitivity)],
    reporting_items: [...new Set(reporting_items)],
    assumptions: assumptionsFor(primary_method),
    pitfalls: pitfallsFor(input.design, primary_method, f),
    caveats,
  };
}
