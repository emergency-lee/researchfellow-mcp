// Anticipated reviewer objections + response drafts. Deterministic: reads
// methodological signals from the manuscript and design and returns the pushback
// a peer reviewer of an observational study is most likely to raise, each with a
// drafted response. Distinct from checklist-critique (reporting-item gaps): this
// is reviewer-framed methodological challenge.

export const PLAYBOOK_VERSION = "playbook-rules-v1";

export type Likelihood = "high" | "medium" | "low";

export interface Objection {
  topic: string;
  likelihood: Likelihood;
  objection: string;
  why_it_matters: string;
  suggested_response: string;
}

const RE = {
  activeComparator: /(active[- ]comparator|new[- ]user)/,
  landmark: /(landmark|time[- ]dependent|time[- ]varying)/,
  survival: /(hazard ratio|\bcox\b|kaplan[- ]meier|survival|time[- ]to[- ]event)/,
  exposureEvent: /(first prescription|initiation|treatment start|drug start|index prescription|index date)/,
  competing: /(competing risk|fine[- ]gray|fine and gray|cause[- ]specific|subdistribution)/,
  cumInc: /(cumulative incidence|kaplan[- ]meier)/,
  death: /(death|mortality|died)/,
  sensitivity: /(e-value|sensitivity analys|negative control|quantitative bias)/,
  multipleTesting: /(multiple (comparison|testing)|bonferroni|false discovery|pre[- ]?specified)/,
  subgroup: /(subgroup|interaction)/,
  ps: /(propensity|matching|iptw|weighting)/,
  pvalue: /(p\s?[<=]\s?0|p-value|p value)/,
  singleCenter: /(single[- ](center|centre)|one hospital|single institution|single site)/,
  causal: /\b(caused|causes|causal)\b/,
  trial: /(randomi[sz]ed|\brct\b|randomly assigned)/,
  lossFU: /(loss to follow-up|lost to follow|censor)/,
};

export interface PlaybookInput {
  manuscript: string;
  design?: string;
}

export function anticipateObjections(input: PlaybookInput): Objection[] {
  const t = input.manuscript.replace(/<!--[\s\S]*?-->/g, " ").toLowerCase();
  const observational = input.design !== "prediction";
  const out: Objection[] = [];

  if (observational && !RE.activeComparator.test(t)) {
    out.push({
      topic: "confounding_by_indication",
      likelihood: "high",
      objection: "Treated patients differ systematically from comparators (confounding by indication).",
      why_it_matters: "It is the dominant threat in observational comparative studies and can fully explain the effect.",
      suggested_response:
        "Adopt/justify an active-comparator, new-user design; report covariate balance and an E-value for residual confounding.",
    });
  }

  if (RE.survival.test(t) && RE.exposureEvent.test(t) && !RE.landmark.test(t)) {
    out.push({
      topic: "immortal_time_bias",
      likelihood: "high",
      objection: "Time between eligibility and exposure ascertainment may be misallocated (immortal time).",
      why_it_matters: "Misallocated immortal time biases the exposed group toward apparent benefit.",
      suggested_response:
        "Align time zero; use a landmark analysis or model exposure as time-dependent, and state it explicitly.",
    });
  }

  if (RE.cumInc.test(t) && RE.death.test(t) && !RE.competing.test(t)) {
    out.push({
      topic: "competing_risks",
      likelihood: "medium",
      objection: "Death (or another competing event) is not handled as a competing risk.",
      why_it_matters: "Standard Kaplan-Meier/Cox overestimates cumulative incidence under competing events.",
      suggested_response:
        "Use cause-specific hazards (etiology) or a Fine-Gray subdistribution model (absolute risk) and say which.",
    });
  }

  if (observational && !RE.sensitivity.test(t)) {
    out.push({
      topic: "residual_confounding",
      likelihood: "high",
      objection: "Residual/unmeasured confounding is not quantified.",
      why_it_matters: "Reviewers expect more than a sentence in Limitations for the field's main weakness.",
      suggested_response: "Add an E-value and, where possible, negative-control analyses.",
    });
  }

  if (RE.subgroup.test(t) && !RE.multipleTesting.test(t)) {
    out.push({
      topic: "multiple_comparisons",
      likelihood: "medium",
      objection: "Subgroup/interaction analyses are not pre-specified or adjusted for multiplicity.",
      why_it_matters: "Unadjusted multiplicity inflates false positives; reviewers distrust post-hoc subgroups.",
      suggested_response: "Label analyses pre-specified vs exploratory; report interaction tests, not just subgroup p-values.",
    });
  }

  if (RE.ps.test(t) && RE.pvalue.test(t)) {
    out.push({
      topic: "table1_pvalues",
      likelihood: "medium",
      objection: "Baseline table uses p-values in a matched/weighted design.",
      why_it_matters: "After matching/weighting, balance is assessed by standardized mean differences, not hypothesis tests.",
      suggested_response: "Replace Table 1 p-values with standardized mean differences (target < 0.1).",
    });
  }

  if (RE.singleCenter.test(t)) {
    out.push({
      topic: "generalizability",
      likelihood: "medium",
      objection: "Single-center data limit external validity.",
      why_it_matters: "Reviewers question whether findings transport beyond one setting/population.",
      suggested_response: "Discuss generalizability explicitly; if feasible, add external validation or multi-site data.",
    });
  }

  if (RE.causal.test(t) && !RE.trial.test(t)) {
    out.push({
      topic: "causal_overreach",
      likelihood: "high",
      objection: "Causal language is used for a non-randomized design.",
      why_it_matters: "Overstated causality is a common desk-reject/major-revision trigger.",
      suggested_response: "Use association language, or justify a formal causal framework (target-trial emulation).",
    });
  }

  if (input.design === "cohort" && RE.survival.test(t) && !RE.lossFU.test(t)) {
    out.push({
      topic: "loss_to_follow_up",
      likelihood: "low",
      objection: "Loss to follow-up / censoring handling is not described.",
      why_it_matters: "Informative censoring can bias time-to-event estimates.",
      suggested_response: "Report follow-up completeness and how censoring was handled; consider a sensitivity analysis.",
    });
  }

  const order: Record<Likelihood, number> = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => order[a.likelihood] - order[b.likelihood]);
}
