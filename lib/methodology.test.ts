import { describe, it, expect } from "vitest";
import {
  recommendMethodology,
  Constraint,
  LOCAL_IMPLEMENTATION_SUPPORT,
  methodFeaturesSchema,
} from "@/lib/methodology";

describe("recommendMethodology — outcome-type routing", () => {
  it("cohort + time-to-event -> Cox with PH diagnostic", () => {
    const r = recommendMethodology({ design: "cohort", outcome_type: "time_to_event" });
    expect(r.primary_method).toBe("cox_ph");
    expect(r.effect_measure).toBe("hazard_ratio");
    expect(r.mandatory_diagnostics).toContain("proportional_hazards");
  });

  it("continuous prediction is not logistic", () => {
    const r = recommendMethodology({ design: "prediction", outcome_type: "continuous" });
    expect(r.primary_method).toBe("linear_prediction_model");
    expect(r.primary_method).not.toMatch(/logistic/);
    expect(r.confounding_strategy).toBe("not_applicable_prediction_uses_predictors");
    expect(r.rationale_codes).toContain("continuous_prediction_not_logistic");
    expect(r.reporting_items).toContain("TRIPOD+AI");
    expect(r.reporting_items.join(" ")).not.toMatch(/TRIPOD-10d/);
  });

  it("cross_sectional continuous uses linear, not a prevalence-ratio model", () => {
    const r = recommendMethodology({ design: "cross_sectional", outcome_type: "continuous" });
    expect(r.primary_method).toBe("linear_regression");
    expect(r.effect_measure).toBe("mean_difference");
    expect(r.primary_method).not.toBe("log_binomial");
    expect(r.primary_method).not.toBe("prevalence_ratio_model");
  });

  it("cross_sectional count uses a rate model with offset", () => {
    const r = recommendMethodology({ design: "cross_sectional", outcome_type: "count" });
    expect(r.primary_method).toBe("poisson_rate_with_offset");
    expect(r.effect_measure).toBe("rate_ratio");
    expect(r.mandatory_diagnostics).toContain("offset_and_dispersion");
  });

  it("cross_sectional binary is a prevalence ratio, not unqualified risk", () => {
    const r = recommendMethodology({ design: "cross_sectional", outcome_type: "binary" });
    expect(r.primary_method).toBe("prevalence_ratio_model");
    expect(r.effect_measure).toBe("prevalence_ratio");
    expect(r.effect_measure).not.toBe("risk_ratio");
    expect(r.rationale_codes).toContain("cross_sectional_binary_prevalence_not_risk");
  });

  it("cohort + common binary outcome -> log-binomial (RR, not OR)", () => {
    const r = recommendMethodology({ design: "cohort", outcome_type: "binary" });
    expect(r.primary_method).toBe("log_binomial");
    expect(r.effect_measure).toBe("risk_ratio");
  });

  it("cohort + rare binary outcome -> logistic (OR≈RR)", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "binary",
      features: { rare_outcome: true },
    });
    expect(r.primary_method).toBe("logistic");
    expect(r.effect_measure).toBe("odds_ratio");
    expect(r.rationale_codes).toContain("rare_binary_or_approx_rr");
  });

  it("matched case-control -> conditional logistic", () => {
    const r = recommendMethodology({
      design: "case_control",
      outcome_type: "binary",
      features: { matched: true },
    });
    expect(r.primary_method).toBe("conditional_logistic");
    expect(r.effect_measure).toBe("odds_ratio");
  });
});

describe("recommendMethodology — competing risks vs causal horizon", () => {
  it("competing risks alone do not auto-select Fine-Gray", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "time_to_event",
      features: { competing_risks: true },
    });
    expect(r.primary_method).not.toBe("fine_gray");
    expect(r.primary_method).toBe("cause_specific_cox");
    expect(r.effect_measure).toBe("cause_specific_hazard_ratio");
    expect(r.constraints).toContain(Constraint.competingRiskUnspecified);
    expect(r.strongest_alternative.primary_method).toBe("cif_fixed_horizon");
  });

  it("competing risks + fixed-horizon CIF target -> CIF, not subdistribution HR", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "time_to_event",
      features: {
        competing_risks: true,
        outcome_time: {
          competing_risk_target: "fixed_horizon_cif",
          causal_horizon: "cif",
        },
      },
    });
    expect(r.primary_method).toBe("cif_fixed_horizon");
    expect(r.effect_measure).toBe("cumulative_incidence");
    expect(r.primary_method).not.toBe("fine_gray");
    expect(r.mandatory_diagnostics).toEqual(
      expect.arrayContaining(["cause_definitions", "cif_vs_hazard_label"]),
    );
  });

  it("subdistribution target -> Fine-Gray, labeled as subdistribution not risk", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "time_to_event",
      features: {
        competing_risks: true,
        outcome_time: { competing_risk_target: "subdistribution_hazard" },
      },
    });
    expect(r.primary_method).toBe("fine_gray");
    expect(r.effect_measure).toBe("subdistribution_hazard_ratio");
    expect(r.strongest_alternative.reason_code).toBe("subdistribution_hr_is_not_cif_risk");
  });
});

describe("recommendMethodology — confounding vs information", () => {
  it("few events and many confounders do not imply IPTW", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "binary",
      features: { confounders_present: true, many_confounders_few_events: true },
    });
    expect(r.confounding_strategy).not.toBe("iptw");
    expect(r.confounding_strategy).not.toMatch(/iptw/i);
    expect(r.confounding_strategy).toBe("multivariable_conditional");
    expect(r.constraints).toContain(Constraint.fewEventsNotWeighting);
    expect(r.constraints).toContain(Constraint.sparseEvents);
    expect(r.rationale_codes).toContain("few_events_do_not_select_iptw");
    expect(r.primary_method).toBe("firth_logistic");
  });

  it("small comparator with many controls limits the small arm; 1:1 matching is not automatic", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "binary",
      features: {
        confounders_present: true,
        exposure_groups: {
          exposed: { n: 5, events: 2, non_events: 3 },
          comparator: { n: 400, events: 40, non_events: 360 },
        },
      },
    });
    expect(r.constraints).toContain(Constraint.unequalGroupsSmallArm);
    expect(r.constraints).toContain(Constraint.tinyGroup);
    expect(r.constraints).toContain(Constraint.sampleSizeContextual);
    expect(r.confounding_strategy).not.toMatch(/iptw/i);
    expect(r.failure_conditions).toContain("tiny_comparator_arm");
    expect(JSON.stringify(r)).not.toMatch(/1:1 matching is automatically/);
  });

  it("low overlap / ESS limits estimation and blocks ATE IPTW", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "binary",
      features: {
        confounders_present: true,
        estimand: { target: "marginal" },
        n_total: 200,
        overlap: { positivity_concern: true, ess_total: 12, ess_exposed: 4, ess_comparator: 8 },
      },
    });
    expect(r.constraints).toContain(Constraint.lowEss);
    expect(r.constraints).toContain(Constraint.positivityLimitsWeighting);
    expect(r.confounding_strategy).toBe("overlap_weights_or_restrict_population");
    expect(r.confounding_strategy).not.toBe("iptw");
    expect(r.failure_conditions).toContain("no_overlap_identification_fails");
    expect(r.mandatory_diagnostics).toEqual(expect.arrayContaining(["overlap_and_ess", "balance_smd"]));
  });

  it("too few clusters limits estimation; robust SE is not a solution", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "continuous",
      features: { confounders_present: true, cluster_count: 4, independent_n: 400 },
    });
    expect(r.constraints).toContain(Constraint.fewClusters);
    expect(r.failure_conditions).toContain("few_clusters_sandwich_unreliable");
    expect(r.mandatory_diagnostics).toContain("cluster_information");
    expect(r.pitfalls.join(" ")).toMatch(/few clusters/i);
  });

  it("treatment-confounder feedback selects MSM/g-methods, not ordinary time-dependent Cox as the confounding strategy", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "time_to_event",
      features: {
        confounders_present: true,
        time_varying_exposure: true,
        time_varying_confounding_feedback: true,
      },
    });
    expect(r.confounding_strategy).toBe("msm_or_g_methods");
    expect(r.constraints).toContain(Constraint.feedbackRequiresG);
    expect(r.rationale_codes).toContain("treatment_confounder_feedback_g_methods");
    expect(r.strongest_alternative.confounding_strategy).toBe("parametric_g_formula");
    expect(r.mandatory_diagnostics).toEqual(
      expect.arrayContaining(["sequential_positivity", "cumulative_weight_ess"]),
    );
  });

  it("time-varying exposure without feedback is a covariate process, not MSM", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "time_to_event",
      features: { confounders_present: true, time_varying_exposure: true },
    });
    expect(r.primary_method).toBe("cox_td_covariate");
    expect(r.confounding_strategy).not.toBe("msm_or_g_methods");
    expect(r.confounding_strategy).toBe("multivariable_conditional");
  });

  it("explicit marginal target with overlap uses g-computation, not default IPTW", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "binary",
      features: {
        confounders_present: true,
        estimand: { target: "marginal" },
        n_total: 800,
        overlap: { positivity_concern: false, ess_total: 700 },
      },
    });
    expect(r.confounding_strategy).toBe("g_computation_marginal");
    expect(r.strongest_alternative.confounding_strategy).toBe("iptw_marginal");
    expect(r.strongest_alternative.reason_code).toBe("iptw_if_overlap_and_ess_adequate");
  });

  it("does not auto-approve sample size from an EPV10-style ratio", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "binary",
      features: {
        confounders_present: true,
        candidate_df: 5,
        exposure_groups: {
          exposed: { n: 200, events: 40, non_events: 160 },
          comparator: { n: 200, events: 30, non_events: 170 },
        },
      },
    });
    expect(r.constraints).toContain(Constraint.sampleSizeContextual);
    expect(r.constraints).not.toContain("epv10_adequate");
    expect(r.constraints).not.toContain("sample_size_approved");
    expect(r.constraints.join(" ")).not.toMatch(/epv/i);
  });

  it("unadjusted cohort flags confounding-by-indication as a pitfall", () => {
    const r = recommendMethodology({ design: "cohort", outcome_type: "binary" });
    expect(r.confounding_strategy).toBe("none_unadjusted_must_justify");
    expect(r.pitfalls.join(" ")).toMatch(/confounding by indication/i);
  });
});

describe("recommendMethodology — sensitivity, reporting, implementation honesty", () => {
  it("does not universally prescribe E-value, negative controls, or MICE", () => {
    const r = recommendMethodology({ design: "cohort", outcome_type: "binary" });
    expect(r.sensitivity).not.toContain("e_value_for_unmeasured_confounding");
    expect(r.sensitivity).not.toContain("negative_control_outcome");
    expect(r.sensitivity).not.toContain("multiple_imputation_mice");
  });

  it("missing_data without mechanism does not auto-prescribe MICE", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "binary",
      features: { missing_data: true },
    });
    expect(r.constraints).toContain(Constraint.missingnessUnspecified);
    expect(r.sensitivity).not.toContain("multiple_imputation_mice");
    expect(r.mandatory_diagnostics).toContain("missingness_mechanism");
    expect(r.reporting_items).toContain("STROBE-12c");
  });

  it("MAR missingness may consider MI; MNAR does not become MICE", () => {
    const mar = recommendMethodology({
      design: "cohort",
      outcome_type: "binary",
      features: { missingness: { indicated: true, mechanism: "mar" } },
    });
    expect(mar.sensitivity).toContain("multiple_imputation_if_mar");
    const mnar = recommendMethodology({
      design: "cohort",
      outcome_type: "binary",
      features: { missingness: { indicated: true, mechanism: "mnar" } },
    });
    expect(mnar.sensitivity).toContain("mnar_tipping_or_pattern_mixture");
    expect(mnar.sensitivity).not.toContain("multiple_imputation_if_mar");
  });

  it("routinely-collected data points at RECORD without claiming item-level compliance", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "time_to_event",
      features: { routinely_collected: true },
    });
    expect(r.reporting_items).toContain("RECORD");
    expect(r.reporting_items).not.toEqual(expect.arrayContaining(["RECORD-R5", "RECORD-R6", "RECORD-R8"]));
    expect(r.sensitivity).toContain("alternative_code_definition");
    expect(r.caveats.join(" ")).toMatch(/not a completed compliance/i);
  });

  it("local implementation support is requires_local_validation, not a runtime capability claim", () => {
    const r = recommendMethodology({ design: "cohort", outcome_type: "binary" });
    expect(r.local_implementation_support).toBe(LOCAL_IMPLEMENTATION_SUPPORT);
    expect(r.caveats.join(" ")).toMatch(/cannot be inferred from a method name/i);
  });

  it("prediction design uses predictors, not confounders, and requires validation diagnostics", () => {
    const r = recommendMethodology({ design: "prediction", outcome_type: "binary" });
    expect(r.confounding_strategy).toMatch(/prediction/);
    expect(r.reporting_items).toContain("TRIPOD+AI");
    expect(r.mandatory_diagnostics).toEqual(
      expect.arrayContaining(["discrimination_and_calibration", "optimism_corrected_or_external_validation"]),
    );
  });
});

describe("recommendMethodology — horizon support vs median follow-up", () => {
  it("horizon > median with substantial n_at_risk is a review warning, not unsupported", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "time_to_event",
      features: {
        follow_up: { median: 180, horizon: 365, unit: "day", n_at_risk_at_horizon: 200 },
      },
    });
    expect(r.constraints).toContain(Constraint.horizonBeyondMedianReview);
    expect(r.constraints).not.toContain(Constraint.horizonUnsupported);
    expect(r.failure_conditions).not.toContain("horizon_without_risk_set");
  });

  it("horizon > median without n_at_risk does not infer unsupported precision", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "time_to_event",
      features: { follow_up: { median: 12, horizon: 24, unit: "month" } },
    });
    expect(r.constraints).toContain(Constraint.horizonBeyondMedianReview);
    expect(r.constraints).not.toContain(Constraint.horizonUnsupported);
    expect(r.failure_conditions).not.toContain("horizon_without_risk_set");
  });

  it("tiny n_at_risk is insufficient support even if horizon is at or below median", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "time_to_event",
      features: { follow_up: { median: 365, horizon: 365, n_at_risk_at_horizon: 2 } },
    });
    expect(r.constraints).toContain(Constraint.horizonUnsupported);
    expect(r.failure_conditions).toContain("horizon_without_risk_set");
  });
});

describe("recommendMethodology — binary limiting class vs non-binary incidence", () => {
  it("common binary outcome with few non-events is sparse", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "binary",
      features: {
        confounders_present: true,
        exposure_groups: { exposed: { n: 1000, events: 995 } },
      },
    });
    expect(r.constraints).toContain(Constraint.sparseEvents);
    expect(r.primary_method).toBe("firth_logistic");
    expect(r.confounding_strategy).not.toMatch(/iptw/i);
  });

  it("does not apply non-event sparsity to survival incidence", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "time_to_event",
      features: {
        exposure_groups: { exposed: { n: 1000, events: 995, non_events: 5 } },
      },
    });
    expect(r.constraints).not.toContain(Constraint.sparseEvents);
    expect(r.primary_method).toBe("cox_ph");
  });

  it("does not apply non-event sparsity to continuous or count outcomes", () => {
    const counts = { exposed: { n: 1000, events: 995, non_events: 5 } };
    const cont = recommendMethodology({
      design: "cohort",
      outcome_type: "continuous",
      features: { exposure_groups: counts },
    });
    expect(cont.constraints).not.toContain(Constraint.sparseEvents);
    expect(cont.primary_method).toBe("linear_regression");
    const count = recommendMethodology({
      design: "cohort",
      outcome_type: "count",
      features: { exposure_groups: counts },
    });
    expect(count.constraints).not.toContain(Constraint.sparseEvents);
    expect(count.primary_method).toBe("poisson_rate_with_offset");
  });

  it("does not infer a study event total from one of two incomplete groups", () => {
    const r = recommendMethodology({
      design: "cohort",
      outcome_type: "binary",
      features: {
        exposure_groups: {
          exposed: { n: 80, events: 4, non_events: 76 },
          comparator: { n: 80 },
        },
      },
    });
    expect(r.constraints).not.toContain(Constraint.sparseEvents);
  });
});

describe("methodFeaturesSchema — bounded strict aggregates", () => {
  it("accepts existing boolean fields", () => {
    const parsed = methodFeaturesSchema.safeParse({
      confounders_present: true,
      many_confounders_few_events: false,
      competing_risks: true,
      time_varying_exposure: false,
      rare_outcome: true,
      missing_data: false,
      routinely_collected: true,
      matched: false,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown raw/table keys without echoing row values", () => {
    const raw = { patient_id: "secret-row-xyz", hb: 8.1 };
    const parsed = methodFeaturesSchema.safeParse({ raw: [raw], table: [raw] });
    expect(parsed.success).toBe(false);
    const blob = JSON.stringify(parsed);
    expect(blob).not.toContain("secret-row-xyz");
    expect(blob).not.toContain("8.1");
  });

  it("rejects contradictory group counts without echoing values", () => {
    const eventsGtN = methodFeaturesSchema.safeParse({
      exposure_groups: { exposed: { n: 10, events: 12 } },
    });
    expect(eventsGtN.success).toBe(false);
    expect(JSON.stringify(eventsGtN)).not.toContain("12");

    const sumGtN = methodFeaturesSchema.safeParse({
      exposure_groups: { comparator: { n: 10, events: 8, non_events: 8 } },
    });
    expect(sumGtN.success).toBe(false);
    expect(JSON.stringify(sumGtN)).not.toMatch(/"8"/);
  });

  it("rejects independent_n greater than n_total without echoing values", () => {
    const parsed = methodFeaturesSchema.safeParse({ n_total: 100, independent_n: 250 });
    expect(parsed.success).toBe(false);
    const blob = JSON.stringify(parsed);
    expect(blob).not.toContain("250");
    expect(blob).not.toContain("100");
  });

  it("accepts partial counts that do not identify a total", () => {
    const parsed = methodFeaturesSchema.safeParse({
      exposure_groups: { exposed: { events: 20 }, comparator: { n: 80 } },
    });
    expect(parsed.success).toBe(true);
  });
});
