// Deterministic methodology recommender (server-side depth counterpart to the
// plugin's references/methodology.md). Pure + fully testable: no I/O here. The
// tool layer (tools/methodology-advisor.ts) adds PubMed precedent + entitlement.
//
// Information profile constrains recommendations. Numeric cutoffs below are
// constraint triggers, not validity/approval gates (no EPV10 auto-pass).

import { z } from "zod";

export const RULES_VERSION = "advisor-rules-v2.1";

export const LOCAL_IMPLEMENTATION_SUPPORT = "requires_local_validation" as const;

/** Constraint triggers only — not laws of validity. */
const TINY_GROUP_N = 5;
const FEW_CLUSTERS = 10;
const LOW_ESS_ABS = 20;
const LOW_ESS_RATIO = 0.5;
const SPARSE_EVENT_COUNT = 10;
const UNEQUAL_RATIO = 10;

export const Constraint = {
  tinyGroup: "tiny_group_limits_estimation",
  fewClusters: "few_clusters_limit_estimation",
  lowEss: "low_ess_limits_estimation",
  sparseEvents: "sparse_events_limit_outcome_model",
  fewEventsNotWeighting: "few_events_separate_from_confounding_strategy",
  competingRiskUnspecified: "competing_risk_estimand_unspecified",
  feedbackRequiresG: "feedback_requires_g_methods",
  sampleSizeContextual: "sample_size_contextual",
  positivityLimitsWeighting: "positivity_limits_weighting",
  horizonBeyondMedianReview: "horizon_beyond_median_follow_up_review_support",
  horizonUnsupported: "horizon_unsupported_by_follow_up",
  independentNNotRows: "independent_n_not_row_count",
  unequalGroupsSmallArm: "unequal_groups_small_arm_limits_precision",
  missingnessUnspecified: "missingness_mechanism_unspecified",
} as const;

export type ConstraintCode = (typeof Constraint)[keyof typeof Constraint];

const countInt = z.number().int().nonnegative().max(1_000_000_000);
const finiteNonneg = z.number().finite().nonnegative().max(1_000_000_000);

const groupCountsSchema = z
  .object({
    n: countInt.optional(),
    events: countInt.optional(),
    non_events: countInt.optional(),
  })
  .strict()
  .superRefine((g, ctx) => {
    if (g.n !== undefined && g.events !== undefined && g.events > g.n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid_input" });
    }
    if (g.n !== undefined && g.non_events !== undefined && g.non_events > g.n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid_input" });
    }
    if (
      g.n !== undefined &&
      g.events !== undefined &&
      g.non_events !== undefined &&
      g.events + g.non_events > g.n
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid_input" });
    }
  });

const noEchoErrorMap: z.ZodErrorMap = () => ({ message: "invalid_input" });

export const methodFeaturesSchema = z
  .object(
    {
    confounders_present: z.boolean().optional(),
    many_confounders_few_events: z.boolean().optional(),
    competing_risks: z.boolean().optional(),
    time_varying_exposure: z.boolean().optional(),
    rare_outcome: z.boolean().optional(),
    missing_data: z.boolean().optional(),
    routinely_collected: z.boolean().optional(),
    matched: z.boolean().optional(),
    time_varying_confounding_feedback: z.boolean().optional(),

    n_total: countInt.optional(),
    independent_n: countInt.optional(),
    candidate_df: z.number().int().nonnegative().max(10_000).optional(),
    cluster_count: countInt.optional(),

    exposure_groups: z
      .object({
        exposed: groupCountsSchema.optional(),
        comparator: groupCountsSchema.optional(),
      })
      .strict()
      .optional(),

    follow_up: z
      .object({
        median: finiteNonneg.optional(),
        horizon: finiteNonneg.optional(),
        unit: z.enum(["day", "week", "month", "year"]).optional(),
        n_at_risk_at_horizon: countInt.optional(),
      })
      .strict()
      .optional(),

    overlap: z
      .object({
        imbalance: z.boolean().optional(),
        positivity_concern: z.boolean().optional(),
        ess_exposed: finiteNonneg.optional(),
        ess_comparator: finiteNonneg.optional(),
        ess_total: finiteNonneg.optional(),
      })
      .strict()
      .optional(),

    sampling_target: z
      .enum([
        "prevalence",
        "cohort_risk",
        "odds",
        "rate",
        "conditional_association",
        "marginal_effect",
      ])
      .optional(),

    estimand: z
      .object({
        target: z.enum(["conditional", "marginal"]).optional(),
      })
      .strict()
      .optional(),

    outcome_time: z
      .object({
        competing_risk_target: z
          .enum(["cause_specific_hazard", "subdistribution_hazard", "fixed_horizon_cif"])
          .optional(),
        exposure_timing: z
          .enum(["baseline", "time_varying_covariate", "treatment_confounder_feedback"])
          .optional(),
        causal_horizon: z.enum(["hazard", "fixed_horizon_risk", "cif", "rmst"]).optional(),
      })
      .strict()
      .optional(),

    missingness: z
      .object({
        indicated: z.boolean().optional(),
        mechanism: z
          .enum(["unknown", "structural", "mcar", "mar", "mnar", "lost_to_follow_up"])
          .optional(),
      })
      .strict()
      .optional(),
    },
    { errorMap: noEchoErrorMap },
  )
  .strict()
  .superRefine((f, ctx) => {
    if (f.n_total !== undefined && f.independent_n !== undefined && f.independent_n > f.n_total) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid_input" });
    }
  });

export type MethodFeatures = z.infer<typeof methodFeaturesSchema>;

export const DesignSchema = z.enum(["cohort", "case_control", "cross_sectional", "prediction"]);
export const OutcomeTypeSchema = z.enum(["binary", "time_to_event", "count", "continuous"]);

export type Design = z.infer<typeof DesignSchema>;
export type OutcomeType = z.infer<typeof OutcomeTypeSchema>;

export interface MethodologyInput {
  design: Design;
  outcome_type: OutcomeType;
  features?: MethodFeatures;
}

export interface StrongestAlternative {
  primary_method: string;
  confounding_strategy: string;
  reason_code: string;
}

export interface Recommendation {
  estimand_framing: string;
  primary_method: string;
  confounding_strategy: string;
  effect_measure: string;
  rationale_codes: string[];
  strongest_alternative: StrongestAlternative;
  failure_conditions: string[];
  mandatory_diagnostics: string[];
  constraints: string[];
  local_implementation_support: typeof LOCAL_IMPLEMENTATION_SUPPORT;
  sensitivity: string[];
  reporting_items: string[];
  assumptions: string[];
  pitfalls: string[];
  caveats: string[];
}

function hasFeedback(f: MethodFeatures): boolean {
  return (
    f.time_varying_confounding_feedback === true ||
    f.outcome_time?.exposure_timing === "treatment_confounder_feedback"
  );
}

function hasTdCovariate(f: MethodFeatures): boolean {
  if (hasFeedback(f)) return false;
  return (
    f.time_varying_exposure === true ||
    f.outcome_time?.exposure_timing === "time_varying_covariate"
  );
}

function competingPresent(f: MethodFeatures): boolean {
  return f.competing_risks === true || f.outcome_time?.competing_risk_target !== undefined;
}

function missingIndicated(f: MethodFeatures): boolean {
  return f.missing_data === true || f.missingness?.indicated === true;
}

function marginalTarget(f: MethodFeatures): boolean {
  return f.estimand?.target === "marginal" || f.sampling_target === "marginal_effect";
}

function conditionalTarget(f: MethodFeatures): boolean {
  return (
    f.estimand?.target === "conditional" || f.sampling_target === "conditional_association"
  );
}

function groupN(g: { n?: number; events?: number; non_events?: number } | undefined): number | undefined {
  if (!g) return undefined;
  if (g.n !== undefined) return g.n;
  if (g.events !== undefined && g.non_events !== undefined) return g.events + g.non_events;
  return undefined;
}

function analyzedN(f: MethodFeatures): number | undefined {
  if (f.independent_n !== undefined) return f.independent_n;
  const exp = groupN(f.exposure_groups?.exposed);
  const cmp = groupN(f.exposure_groups?.comparator);
  if (exp !== undefined && cmp !== undefined) return exp + cmp;
  if (f.n_total !== undefined) return f.n_total;
  return exp ?? cmp;
}

function bothExposureGroups(f: MethodFeatures): boolean {
  return f.exposure_groups?.exposed !== undefined && f.exposure_groups?.comparator !== undefined;
}

/** Sum two optional counts only when the total is identified. Do not treat one arm as the study total. */
function identifiedSum(a: number | undefined, b: number | undefined, bothPresent: boolean): number | undefined {
  if (a !== undefined && b !== undefined) return a + b;
  if (bothPresent) return undefined;
  return a ?? b;
}

type GroupCounts = { n?: number; events?: number; non_events?: number };

function groupEvents(g: GroupCounts | undefined): number | undefined {
  if (!g) return undefined;
  if (g.events !== undefined) return g.events;
  if (g.n !== undefined && g.non_events !== undefined && g.non_events <= g.n) return g.n - g.non_events;
  return undefined;
}

function groupNonEvents(g: GroupCounts | undefined): number | undefined {
  if (!g) return undefined;
  if (g.non_events !== undefined) return g.non_events;
  if (g.n !== undefined && g.events !== undefined && g.events <= g.n) return g.n - g.events;
  return undefined;
}

function totalEvents(f: MethodFeatures): number | undefined {
  return identifiedSum(
    groupEvents(f.exposure_groups?.exposed),
    groupEvents(f.exposure_groups?.comparator),
    bothExposureGroups(f),
  );
}

function totalNonEvents(f: MethodFeatures): number | undefined {
  return identifiedSum(
    groupNonEvents(f.exposure_groups?.exposed),
    groupNonEvents(f.exposure_groups?.comparator),
    bothExposureGroups(f),
  );
}

function identifiedGroupN(f: MethodFeatures): number | undefined {
  return identifiedSum(groupN(f.exposure_groups?.exposed), groupN(f.exposure_groups?.comparator), bothExposureGroups(f));
}

function binaryStudyN(f: MethodFeatures): number | undefined {
  return identifiedGroupN(f) ?? f.n_total;
}

/** Minority class size when both classes are identified. Undefined if a class total cannot be formed. */
function limitingBinaryClassCount(f: MethodFeatures): number | undefined {
  const events = totalEvents(f);
  let nonEvents = totalNonEvents(f);
  if (nonEvents === undefined && events !== undefined) {
    const n = binaryStudyN(f);
    if (n !== undefined && events <= n) nonEvents = n - events;
  }
  if (events === undefined || nonEvents === undefined) return undefined;
  return Math.min(events, nonEvents);
}

function essTotal(f: MethodFeatures): number | undefined {
  if (f.overlap?.ess_total !== undefined) return f.overlap.ess_total;
  const a = f.overlap?.ess_exposed;
  const b = f.overlap?.ess_comparator;
  if (a !== undefined && b !== undefined) return a + b;
  return a ?? b;
}

function lowOverlap(f: MethodFeatures): boolean {
  if (f.overlap?.positivity_concern === true) return true;
  const ess = essTotal(f);
  if (ess === undefined) return false;
  if (ess < LOW_ESS_ABS) return true;
  const n = analyzedN(f);
  if (n !== undefined && n > 0 && ess / n < LOW_ESS_RATIO) return true;
  return false;
}

function sparseByCount(count: number | undefined, df: number | undefined): boolean {
  if (count === undefined) return false;
  if (count < SPARSE_EVENT_COUNT) return true;
  if (df !== undefined && df > 0 && count < df) return true;
  return false;
}

function sparseOutcome(ot: OutcomeType, f: MethodFeatures): boolean {
  if (f.many_confounders_few_events === true) return true;
  const df = f.candidate_df;
  if (ot === "binary") {
    const limiting = limitingBinaryClassCount(f);
    if (limiting !== undefined) return sparseByCount(limiting, df);
    // Only one class identified: use known events, do not invent non-events.
    return sparseByCount(totalEvents(f), df);
  }
  if (ot === "time_to_event") {
    return sparseByCount(totalEvents(f), df);
  }
  return false;
}

function collectConstraints(design: Design, ot: OutcomeType, f: MethodFeatures): string[] {
  const c: string[] = [];
  const infoPresent =
    f.n_total !== undefined ||
    f.independent_n !== undefined ||
    f.candidate_df !== undefined ||
    f.cluster_count !== undefined ||
    f.exposure_groups !== undefined ||
    f.follow_up !== undefined ||
    f.overlap !== undefined;
  if (infoPresent) c.push(Constraint.sampleSizeContextual);

  const expN = groupN(f.exposure_groups?.exposed);
  const cmpN = groupN(f.exposure_groups?.comparator);
  const ns = [expN, cmpN].filter((n): n is number => n !== undefined);
  if (ns.length > 0 && Math.min(...ns) <= TINY_GROUP_N) {
    c.push(Constraint.tinyGroup);
  }
  if (expN !== undefined && cmpN !== undefined) {
    const hi = Math.max(expN, cmpN);
    const lo = Math.min(expN, cmpN);
    if (lo > 0 && hi / lo >= UNEQUAL_RATIO) c.push(Constraint.unequalGroupsSmallArm);
  }

  if (f.cluster_count !== undefined && f.cluster_count < FEW_CLUSTERS) {
    c.push(Constraint.fewClusters);
  }

  if (f.overlap?.positivity_concern === true) c.push(Constraint.positivityLimitsWeighting);
  const ess = essTotal(f);
  if (ess !== undefined) {
    const n = analyzedN(f);
    if (ess < LOW_ESS_ABS || (n !== undefined && n > 0 && ess / n < LOW_ESS_RATIO)) {
      c.push(Constraint.lowEss);
    }
  }

  if (sparseOutcome(ot, f)) {
    c.push(Constraint.sparseEvents);
    c.push(Constraint.fewEventsNotWeighting);
  }

  if (f.n_total !== undefined && f.independent_n !== undefined && f.independent_n < f.n_total) {
    c.push(Constraint.independentNNotRows);
  }

  if (competingPresent(f) && f.outcome_time?.competing_risk_target === undefined) {
    c.push(Constraint.competingRiskUnspecified);
  }

  if (hasFeedback(f)) c.push(Constraint.feedbackRequiresG);

  const horizon = f.follow_up?.horizon;
  const median = f.follow_up?.median;
  if (horizon !== undefined && median !== undefined && horizon > median) {
    c.push(Constraint.horizonBeyondMedianReview);
  }
  const atRisk = f.follow_up?.n_at_risk_at_horizon;
  if (atRisk !== undefined && atRisk <= TINY_GROUP_N) {
    c.push(Constraint.horizonUnsupported);
  }

  if (missingIndicated(f) && (f.missingness?.mechanism === undefined || f.missingness.mechanism === "unknown")) {
    c.push(Constraint.missingnessUnspecified);
  }

  if (design === "cross_sectional" && ot === "time_to_event") {
    c.push(Constraint.sampleSizeContextual);
  }

  return [...new Set(c)];
}

function pickSurvival(f: MethodFeatures): { method: string; measure: string; rationale: string[] } {
  const target = f.outcome_time?.competing_risk_target;
  const horizon = f.outcome_time?.causal_horizon;
  const competing = competingPresent(f);
  const rationale: string[] = [];

  if (competing) {
    if (target === "subdistribution_hazard") {
      rationale.push("competing_risk_subdistribution_hazard");
      return { method: "fine_gray", measure: "subdistribution_hazard_ratio", rationale };
    }
    if (target === "fixed_horizon_cif" || horizon === "cif" || horizon === "fixed_horizon_risk") {
      rationale.push("competing_risk_fixed_horizon_cif");
      return { method: "cif_fixed_horizon", measure: "cumulative_incidence", rationale };
    }
    if (target === "cause_specific_hazard" || horizon === "hazard") {
      rationale.push("competing_risk_cause_specific_hazard");
      return { method: "cause_specific_cox", measure: "cause_specific_hazard_ratio", rationale };
    }
    rationale.push("competing_risk_process_default_not_fine_gray");
    return { method: "cause_specific_cox", measure: "cause_specific_hazard_ratio", rationale };
  }

  if (horizon === "fixed_horizon_risk") {
    rationale.push("fixed_horizon_risk_not_hazard");
    return { method: "fixed_horizon_risk", measure: "risk_difference_or_ratio", rationale };
  }
  if (horizon === "rmst") {
    rationale.push("rmst_time_scale");
    return { method: "rmst", measure: "restricted_mean_survival_time", rationale };
  }
  if (hasTdCovariate(f)) {
    rationale.push("time_varying_covariate_not_feedback");
    return { method: "cox_td_covariate", measure: "hazard_ratio", rationale };
  }
  rationale.push("cohort_time_to_event_cox");
  return { method: "cox_ph", measure: "hazard_ratio", rationale };
}

function pickPrimary(
  design: Design,
  ot: OutcomeType,
  f: MethodFeatures,
): { method: string; measure: string; rationale: string[] } {
  if (design === "prediction") {
    if (ot === "continuous") {
      return {
        method: "linear_prediction_model",
        measure: "predicted_mean",
        rationale: ["continuous_prediction_not_logistic"],
      };
    }
    if (ot === "count") {
      return {
        method: "count_prediction_model",
        measure: "predicted_count_or_rate",
        rationale: ["count_prediction_not_logistic"],
      };
    }
    if (ot === "time_to_event") {
      return {
        method: "cox_prediction_model",
        measure: "predicted_survival_or_risk",
        rationale: ["survival_prediction"],
      };
    }
    return {
      method: "logistic_prediction_model",
      measure: "predicted_probability",
      rationale: ["binary_prediction_logistic"],
    };
  }

  if (design === "case_control") {
    const method = f.matched ? "conditional_logistic" : "logistic";
    return {
      method,
      measure: "odds_ratio",
      rationale: [f.matched ? "matched_case_control_conditional" : "case_control_odds"],
    };
  }

  if (design === "cross_sectional") {
    if (ot === "continuous") {
      return {
        method: "linear_regression",
        measure: "mean_difference",
        rationale: ["cross_sectional_continuous_linear"],
      };
    }
    if (ot === "count") {
      return {
        method: "poisson_rate_with_offset",
        measure: "rate_ratio",
        rationale: ["cross_sectional_count_rate_offset"],
      };
    }
    if (ot === "time_to_event") {
      const surv = pickSurvival(f);
      return {
        ...surv,
        rationale: ["cross_sectional_does_not_identify_cohort_risk", ...surv.rationale],
      };
    }
    return {
      method: "prevalence_ratio_model",
      measure: "prevalence_ratio",
      rationale: ["cross_sectional_binary_prevalence_not_risk"],
    };
  }

  // cohort
  if (ot === "time_to_event") return pickSurvival(f);
  if (ot === "count") {
    return {
      method: "poisson_rate_with_offset",
      measure: "rate_ratio",
      rationale: ["cohort_count_rate_offset"],
    };
  }
  if (ot === "continuous") {
    return {
      method: "linear_regression",
      measure: "mean_difference",
      rationale: ["cohort_continuous_linear"],
    };
  }

  if (sparseOutcome(ot, f) && !f.rare_outcome) {
    return {
      method: "firth_logistic",
      measure: "odds_ratio",
      rationale: ["sparse_binary_firth_not_iptw"],
    };
  }
  if (f.rare_outcome) {
    return {
      method: "logistic",
      measure: "odds_ratio",
      rationale: ["rare_binary_or_approx_rr"],
    };
  }
  return {
    method: "log_binomial",
    measure: "risk_ratio",
    rationale: ["cohort_binary_rr_not_or"],
  };
}

function pickConfounding(
  design: Design,
  ot: OutcomeType,
  f: MethodFeatures,
): { strategy: string; rationale: string[] } {
  const rationale: string[] = [];
  if (design === "prediction") {
    return { strategy: "not_applicable_prediction_uses_predictors", rationale: ["prediction_predictors_not_confounders"] };
  }
  if (hasFeedback(f)) {
    rationale.push("treatment_confounder_feedback_g_methods");
    return { strategy: "msm_or_g_methods", rationale };
  }

  const confounders = f.confounders_present === true || f.many_confounders_few_events === true;
  if (!confounders) {
    return { strategy: "none_unadjusted_must_justify", rationale: ["no_measured_confounders_declared"] };
  }

  if (sparseOutcome(ot, f)) {
    rationale.push("few_events_do_not_select_iptw");
    return { strategy: "multivariable_conditional", rationale };
  }

  if (lowOverlap(f) && marginalTarget(f)) {
    rationale.push("low_overlap_not_ate_iptw");
    return { strategy: "overlap_weights_or_restrict_population", rationale };
  }
  if (lowOverlap(f)) {
    rationale.push("positivity_limits_weighting");
    return { strategy: "multivariable_conditional", rationale };
  }

  if (marginalTarget(f)) {
    rationale.push("explicit_marginal_target");
    return { strategy: "g_computation_marginal", rationale };
  }
  if (conditionalTarget(f) || !f.estimand?.target) {
    rationale.push("conditional_association_default");
    return { strategy: "multivariable_conditional", rationale };
  }
  return { strategy: "multivariable_conditional", rationale };
}

function pickAlternative(
  design: Design,
  ot: OutcomeType,
  f: MethodFeatures,
  method: string,
  strategy: string,
): StrongestAlternative {
  if (hasFeedback(f) && strategy === "msm_or_g_methods") {
    return {
      primary_method: method,
      confounding_strategy: "parametric_g_formula",
      reason_code: "g_formula_if_history_models_specified",
    };
  }
  if (method === "cause_specific_cox" && competingPresent(f)) {
    const horizon = f.outcome_time?.causal_horizon;
    if (horizon === "cif" || horizon === "fixed_horizon_risk") {
      return {
        primary_method: "cif_fixed_horizon",
        confounding_strategy: strategy,
        reason_code: "risk_target_is_cif_not_cause_specific_hr",
      };
    }
    return {
      primary_method: "cif_fixed_horizon",
      confounding_strategy: strategy,
      reason_code: "absolute_risk_needs_cif_not_hazard",
    };
  }
  if (method === "fine_gray") {
    return {
      primary_method: "cif_fixed_horizon",
      confounding_strategy: strategy,
      reason_code: "subdistribution_hr_is_not_cif_risk",
    };
  }
  if (method === "cif_fixed_horizon") {
    return {
      primary_method: "cause_specific_cox",
      confounding_strategy: strategy,
      reason_code: "etiology_uses_cause_specific_hazard",
    };
  }
  if (strategy === "g_computation_marginal") {
    return {
      primary_method: method,
      confounding_strategy: "iptw_marginal",
      reason_code: "iptw_if_overlap_and_ess_adequate",
    };
  }
  if (method === "prevalence_ratio_model" || method === "log_binomial") {
    return {
      primary_method: "poisson_robust",
      confounding_strategy: strategy,
      reason_code: "log_binomial_nonconvergence_fallback",
    };
  }
  if (method === "linear_prediction_model") {
    return {
      primary_method: "penalized_linear_prediction",
      confounding_strategy: strategy,
      reason_code: "shrinkage_if_candidate_df_large",
    };
  }
  if (strategy === "multivariable_conditional" && f.confounders_present) {
    return {
      primary_method: method,
      confounding_strategy: "g_computation_marginal",
      reason_code: "marginal_contrast_if_that_is_the_target",
    };
  }
  if (strategy === "none_unadjusted_must_justify" && design !== "prediction") {
    return {
      primary_method: method,
      confounding_strategy: "multivariable_conditional",
      reason_code: "indication_confounding_if_comparators_differ",
    };
  }
  if (method === "logistic" && ot === "binary" && design === "cohort") {
    return {
      primary_method: "log_binomial",
      confounding_strategy: strategy,
      reason_code: "or_is_not_rr_if_outcome_not_rare",
    };
  }
  return {
    primary_method: method === "cox_ph" ? "fixed_horizon_risk" : method,
    confounding_strategy: strategy,
    reason_code: "alternate_estimand_if_assumptions_fail",
  };
}

function assumptionsFor(method: string): string[] {
  const a: Record<string, string[]> = {
    cox_ph: ["proportional hazards (check Schoenfeld residuals / cox.zph)"],
    cox_td_covariate: [
      "time-dependent covariates require start-stop intervals without future leakage",
      "time-dependent Cox does not identify total effects under treatment-confounder feedback",
    ],
    cause_specific_cox: [
      "cause-specific hazard is a valid event-process target; it is not a cumulative incidence ratio",
      "proportional hazards for the cause-specific model still need checking",
    ],
    fine_gray: [
      "subdistribution hazard is not a cause-specific hazard and is not itself a CIF risk",
      "subdistribution proportional-hazards assumption is distinct from cause-specific PH",
    ],
    cif_fixed_horizon: [
      "Aalen–Johansen / CIF estimates observed-world cumulative incidence; 1−KM with competing events censored is not CIF",
      "causal strategy-specific CIF needs identification plus a compatible adjusted/weighted estimator",
    ],
    fixed_horizon_risk: ["horizon must have adequate numbers at risk in each group"],
    rmst: ["RMST horizon must be prespecified with support in each group"],
    logistic: ["OR approximates RR only when the outcome is rare; otherwise OR is not a risk ratio"],
    firth_logistic: [
      "Firth/penalty can stabilize separation; it does not create events or identify missing comparisons",
    ],
    log_binomial: ["may fail to converge; Poisson with robust SE is the fallback for RR"],
    prevalence_ratio_model: [
      "cross-sectional binary target is a prevalence ratio, not cohort risk",
      "log-binomial may fail to converge; Poisson with robust SE is the fallback",
    ],
    poisson_robust: ["robust (sandwich) SE required; models a rate/risk ratio"],
    poisson_rate_with_offset: [
      "offset must be exposure time/person-time; a count covariate is not an offset",
      "check overdispersion; negative binomial if that mechanism fits",
    ],
    conditional_logistic: ["matched sets modelled via strata; do not break matching"],
    linear_regression: ["linearity of mean, appropriate variance; residual normality is not required for the point estimate"],
    linear_prediction_model: ["report error (MAE/RMSE) and calibration; do not route continuous prediction through logistic"],
    penalized_linear_prediction: ["penalization/shrinkage needs nested resampling for tuning"],
    count_prediction_model: ["count/rate prediction needs an outcome-appropriate likelihood, not logistic"],
    cox_prediction_model: ["proportional hazards; report time-dependent discrimination and horizon-specific calibration"],
    logistic_prediction_model: ["report discrimination (C-statistic) AND calibration; AUC is not clinical utility"],
  };
  return a[method] ?? [];
}

function pitfallsFor(
  design: Design,
  ot: OutcomeType,
  method: string,
  strategy: string,
  f: MethodFeatures,
): string[] {
  const p: string[] = [];
  if (hasTdCovariate(f) || method === "cox_ph" || method === "cox_td_covariate") {
    p.push("immortal time bias — align time zero; use landmark or time-dependent exposure");
  }
  if (hasFeedback(f) && (method === "cox_td_covariate" || method === "cox_ph")) {
    p.push("time-dependent Cox adjustment for downstream confounders does not identify a total effect under feedback");
  }
  if (
    strategy === "iptw_marginal" ||
    strategy === "overlap_weights_or_restrict_population" ||
    strategy === "msm_or_g_methods"
  ) {
    p.push("positivity/overlap — inspect weights and armwise ESS; truncation can change the target population");
  }
  if (design !== "prediction" && strategy === "none_unadjusted_must_justify") {
    p.push("unadjusted estimate — confounding by indication is the dominant threat");
  }
  if (method === "fine_gray") {
    p.push("do not label a subdistribution HR as a risk ratio or as cause-specific etiology");
  }
  if (design === "cross_sectional" && method === "prevalence_ratio_model") {
    p.push("prevalence is not cohort risk; duration/survival into the sample can distort associations");
  }
  if (sparseOutcome(ot, f) && (strategy === "iptw_marginal" || strategy.includes("iptw"))) {
    p.push("few events do not justify IPTW; weighting can further reduce effective sample size");
  }
  if (f.cluster_count !== undefined && f.cluster_count < FEW_CLUSTERS) {
    p.push("ordinary cluster-robust SE is unreliable with few clusters");
  }
  return p;
}

function mandatoryDiagnostics(
  method: string,
  strategy: string,
  design: Design,
  f: MethodFeatures,
): string[] {
  const d: string[] = [];
  if (method === "cox_ph" || method === "cox_td_covariate" || method === "cause_specific_cox" || method === "cox_prediction_model") {
    d.push("proportional_hazards");
  }
  if (method === "fine_gray") d.push("subdistribution_ph");
  if (competingPresent(f) || method === "cif_fixed_horizon") {
    d.push("cause_definitions");
    d.push("cif_vs_hazard_label");
  }
  if (method === "cox_td_covariate") d.push("interval_construction_no_future_leakage");
  if (strategy === "msm_or_g_methods") {
    d.push("sequential_positivity");
    d.push("cumulative_weight_ess");
  }
  if (
    strategy === "g_computation_marginal" ||
    strategy === "overlap_weights_or_restrict_population" ||
    strategy === "iptw_marginal"
  ) {
    d.push("overlap_and_ess");
    d.push("balance_smd");
  }
  if (f.overlap?.imbalance === true) d.push("balance_smd");
  if (design === "prediction") {
    d.push("discrimination_and_calibration");
    d.push("optimism_corrected_or_external_validation");
  }
  if (method === "linear_regression" || method === "linear_prediction_model") d.push("residual_mean_structure");
  if (method === "log_binomial" || method === "prevalence_ratio_model") d.push("convergence_or_poisson_robust_fallback");
  if (method === "poisson_rate_with_offset") d.push("offset_and_dispersion");
  if (f.cluster_count !== undefined) d.push("cluster_information");
  if (missingIndicated(f)) d.push("missingness_mechanism");
  if (f.follow_up?.horizon !== undefined) d.push("numbers_at_risk_at_horizon");
  return [...new Set(d)];
}

function failureConditions(
  method: string,
  strategy: string,
  f: MethodFeatures,
  constraints: string[],
): string[] {
  const x: string[] = [];
  if (constraints.includes(Constraint.positivityLimitsWeighting) || constraints.includes(Constraint.lowEss)) {
    x.push("no_overlap_identification_fails");
  }
  if (constraints.includes(Constraint.fewClusters)) x.push("few_clusters_sandwich_unreliable");
  if (constraints.includes(Constraint.sparseEvents)) x.push("sparse_separation_or_unstable_adjustment");
  if (constraints.includes(Constraint.horizonUnsupported)) x.push("horizon_without_risk_set");
  if (constraints.includes(Constraint.tinyGroup) || constraints.includes(Constraint.unequalGroupsSmallArm)) {
    x.push("tiny_comparator_arm");
  }
  if (hasFeedback(f) && strategy !== "msm_or_g_methods") x.push("feedback_ignored_in_td_cox");
  if (method === "log_binomial" || method === "prevalence_ratio_model") x.push("log_binomial_nonconvergence");
  if (strategy === "msm_or_g_methods") x.push("sequential_positivity_failure");
  return [...new Set(x)];
}

function sensitivityFor(design: Design, f: MethodFeatures): string[] {
  const s: string[] = [];
  if (f.routinely_collected) s.push("alternative_code_definition");
  const mech = f.missingness?.mechanism;
  if (missingIndicated(f)) {
    if (mech === "mar") s.push("multiple_imputation_if_mar");
    else if (mech === "mnar") s.push("mnar_tipping_or_pattern_mixture");
    else if (mech === "lost_to_follow_up") s.push("censoring_model_or_ipcw_if_supported");
    else if (mech === "structural") s.push("preserve_structural_missingness_codes");
    // unknown/unspecified: do not prescribe MICE
  }
  if (design === "prediction") s.push("resampling_optimism_correction");
  // No universal E-value or negative-control menu.
  return [...new Set(s)];
}

function reportingItems(design: Design, f: MethodFeatures): string[] {
  const items: string[] = [];
  if (design === "prediction") {
    items.push("TRIPOD+AI");
  } else {
    items.push("STROBE");
    items.push("STROBE-12");
    items.push("STROBE-16");
    if (missingIndicated(f)) items.push("STROBE-12c");
    if (f.routinely_collected) items.push("RECORD");
  }
  return [...new Set(items)];
}

function framing(design: Design, ot: OutcomeType, f: MethodFeatures, measure: string): string {
  if (design === "prediction") {
    return (
      "Specify development vs validation, prediction moment, outcome/horizon and action. " +
      "Predictors must be available at that moment. Do not treat predictors as causal confounders. " +
      `Primary scale: ${measure}.`
    );
  }
  if (design === "cross_sectional" && ot === "binary") {
    return (
      "Cross-sectional binary sampling identifies prevalence (and a prevalence ratio), not cohort risk. " +
      "State the sampling frame and whether duration in the population distorts the contrast."
    );
  }
  if (design === "case_control") {
    return (
      "Case-control sampling identifies an odds ratio (incidence-density sampling can estimate a rate ratio without a rare-outcome condition). " +
      "Do not convert to cohort risk without source-population information."
    );
  }
  const target = f.estimand?.target ?? (marginalTarget(f) ? "marginal" : "conditional_unless_specified");
  const cr = f.outcome_time?.competing_risk_target;
  const crNote = competingPresent(f)
    ? ` Competing-event target: ${cr ?? "unspecified — distinguish cause-specific hazard, subdistribution hazard, and fixed-horizon CIF"}.`
    : "";
  const fb = hasFeedback(f)
    ? " Exposure process includes treatment-confounder feedback; baseline adjustment or ordinary time-dependent Cox is not sufficient."
    : "";
  return (
    `Frame eligibility, time zero, exposure strategies, comparator, outcome window and contrast (${measure}; ${target} target) before choosing the model.` +
    crNote +
    fb
  );
}

function caveatsFor(): string[] {
  return [
    "This is a structured recommendation, not a substitute for a statistician.",
    "Confirm the estimand and pre-specify the analysis in the SAP before touching real data.",
    "local_implementation_support is requires_local_validation: installed runtime and executable support cannot be inferred from a method name.",
    "Reporting pointers name current checklists; they are not a completed compliance assessment.",
  ];
}

/** Produce a methodology recommendation from a structured, de-identified spec. */
export function recommendMethodology(input: MethodologyInput): Recommendation {
  const f = input.features ?? {};
  const constraints = collectConstraints(input.design, input.outcome_type, f);
  const primary = pickPrimary(input.design, input.outcome_type, f);
  const confounding = pickConfounding(input.design, input.outcome_type, f);
  const rationale_codes = [...new Set([...primary.rationale, ...confounding.rationale])];

  return {
    estimand_framing: framing(input.design, input.outcome_type, f, primary.measure),
    primary_method: primary.method,
    confounding_strategy: confounding.strategy,
    effect_measure: primary.measure,
    rationale_codes,
    strongest_alternative: pickAlternative(
      input.design,
      input.outcome_type,
      f,
      primary.method,
      confounding.strategy,
    ),
    failure_conditions: failureConditions(primary.method, confounding.strategy, f, constraints),
    mandatory_diagnostics: mandatoryDiagnostics(primary.method, confounding.strategy, input.design, f),
    constraints,
    local_implementation_support: LOCAL_IMPLEMENTATION_SUPPORT,
    sensitivity: sensitivityFor(input.design, f),
    reporting_items: reportingItems(input.design, f),
    assumptions: assumptionsFor(primary.method),
    pitfalls: pitfallsFor(input.design, input.outcome_type, primary.method, confounding.strategy, f),
    caveats: caveatsFor(),
  };
}
