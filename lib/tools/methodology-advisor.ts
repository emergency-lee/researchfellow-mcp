import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KB_VERSION, UPGRADE_URL } from "@/lib/version";
import { scanForPhi, phiRejection } from "@/lib/phi-guard";
import { searchPubmedWithFallback, type PubmedArticle } from "@/lib/pubmed";
import { recommendMethodology, RULES_VERSION } from "@/lib/methodology";
import { entitlementOf, jsonResult, logTool, type ToolExtra } from "@/lib/tools/shared";

// PH-1: structured, de-identified input only — no free-form tabular/PHI fields.
const inputSchema = {
  pico: z.object({
    population: z.string().min(1).max(200),
    exposure: z.string().min(1).max(200),
    comparator: z.string().max(200).optional(),
    outcome: z.string().min(1).max(200),
    timeframe: z.string().max(120).optional(),
  }),
  design: z.enum(["cohort", "case_control", "cross_sectional", "prediction"]),
  outcome_type: z.enum(["binary", "time_to_event", "count", "continuous"]).default("binary"),
  features: z
    .object({
      confounders_present: z.boolean().optional(),
      many_confounders_few_events: z.boolean().optional(),
      competing_risks: z.boolean().optional(),
      time_varying_exposure: z.boolean().optional(),
      rare_outcome: z.boolean().optional(),
      missing_data: z.boolean().optional(),
      routinely_collected: z.boolean().optional(),
      matched: z.boolean().optional(),
    })
    .optional(),
  keywords: z.array(z.string().max(80)).max(20).optional(),
};

export function registerMethodologyAdvisor(server: McpServer) {
  server.registerTool(
    "methodology_advisor",
    {
      title: "Methodology Advisor",
      description:
        "Recommend an analysis method for a retrospective observational study (PICO + design + " +
        "outcome type + features) and surface PubMed precedent. Full mode returns the method, " +
        "confounding strategy, assumptions, pitfalls, sensitivity menu, reporting-item crosswalk and " +
        "similar-study examples; teaser returns the headline method + counts. De-identified structured " +
        "input only (no tabular/PHI data).",
      inputSchema,
    },
    async (args, extra: ToolExtra) => {
      const startedAt = Date.now();
      const ent = entitlementOf(extra);

      // PH-2: runtime PHI defence. Reject WITHOUT logging the payload.
      const phi = scanForPhi(args);
      if (phi) {
        logTool("methodology_advisor", `${ent.mode}:phi_rejected`, startedAt);
        return jsonResult(phiRejection(phi));
      }

      const { pico, design, outcome_type, features, keywords } = args;
      const rec = recommendMethodology({ design, outcome_type, features });

      // PubMed precedent (best-effort — never a hard error).
      const search = await searchPubmedWithFallback(pico, keywords);
      const similarCount = search.ok ? search.articles.length : null;

      if (ent.mode === "teaser") {
        logTool("methodology_advisor", "teaser", startedAt);
        return jsonResult({
          mode: "teaser",
          kb_version: KB_VERSION,
          rules_version: RULES_VERSION,
          primary_method: rec.primary_method,
          confounding_strategy: rec.confounding_strategy,
          similar_study_count: similarCount,
          note: "assumptions, pitfalls, sensitivity plan, reporting crosswalk and precedent examples are in full mode",
          upgrade: {
            hint: "Per-Study Pass로 가정·함정·민감도 계획·보고항목 크로스워크·선례 목록을 해제하세요.",
            url: UPGRADE_URL,
          },
        });
      }

      const examples = (search.ok ? search.articles.slice(0, 5) : []).map((a: PubmedArticle) => ({
        pmid: a.pmid,
        title: a.title,
        year: a.year,
        journal: a.journal,
      }));

      logTool("methodology_advisor", "full", startedAt);
      return jsonResult({
        mode: "full",
        kb_version: KB_VERSION,
        rules_version: RULES_VERSION,
        query_used: search.queryUsed,
        recommendation: rec,
        precedent: {
          similar_study_count: similarCount,
          examples,
          note: "Precedent is context, not endorsement — a common method can still be wrong for your estimand.",
        },
      });
    },
  );
}
