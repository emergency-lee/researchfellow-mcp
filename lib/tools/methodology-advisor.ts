import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KB_VERSION } from "@/lib/version";
import { scanForPhi, phiRejection } from "@/lib/phi-guard";
import { searchPubmedWithFallback, type PubmedArticle } from "@/lib/pubmed";
import {
  DesignSchema,
  OutcomeTypeSchema,
  methodFeaturesSchema,
  recommendMethodology,
  RULES_VERSION,
} from "@/lib/methodology";
import { entitlementOf, jsonResult, logTool, type ToolExtra } from "@/lib/tools/shared";

/** Zod messages must not echo received values (patient rows, raw tables, identifiers). */
const noEchoErrorMap: z.ZodErrorMap = () => ({ message: "invalid_input" });

const picoSchema = z
  .object({
    population: z.string().min(1).max(200),
    exposure: z.string().min(1).max(200),
    comparator: z.string().max(200).optional(),
    outcome: z.string().min(1).max(200),
    timeframe: z.string().max(120).optional(),
  })
  .strict();

export const methodologyAdvisorInputSchema = z
  .object(
    {
      pico: picoSchema,
      design: DesignSchema,
      outcome_type: OutcomeTypeSchema.default("binary"),
      features: methodFeaturesSchema.optional(),
      keywords: z.array(z.string().max(80)).max(20).optional(),
    },
    { errorMap: noEchoErrorMap },
  )
  .strict();

export type MethodologyAdvisorInput = z.infer<typeof methodologyAdvisorInputSchema>;

export const INVALID_INPUT = { error: "invalid_input" as const };

/** Parse tool input. Failures return a fixed error object and never echo the payload. */
export function parseMethodologyAdvisorInput(
  input: unknown,
): { ok: true; value: MethodologyAdvisorInput } | { ok: false; error: "invalid_input" } {
  const parsed = methodologyAdvisorInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  return { ok: true, value: parsed.data };
}

export function registerMethodologyAdvisor(server: McpServer) {
  server.registerTool(
    "methodology_advisor",
    {
      title: "Methodology Advisor",
      description:
        "Recommend an analysis method for a retrospective observational study (PICO + design + " +
        "outcome type + features) and surface PubMed precedent. Returns the method, " +
        "confounding strategy, assumptions, pitfalls, sensitivity menu, reporting-item crosswalk and " +
        "similar-study examples. De-identified structured " +
        "input only (no tabular/PHI data)." +
        " Rule-based recommendations plus PubMed precedents; not a statistical consultation.",
      inputSchema: methodologyAdvisorInputSchema,
    },
    async (args, extra: ToolExtra) => {
      const startedAt = Date.now();
      const ent = entitlementOf(extra);

      const parsed = parseMethodologyAdvisorInput(args);
      if (!parsed.ok) {
        logTool("methodology_advisor", `${ent.mode}:invalid_input`, startedAt);
        return jsonResult(INVALID_INPUT);
      }

      // PH-2: runtime PHI defence. Reject WITHOUT logging the payload.
      const phi = scanForPhi(parsed.value);
      if (phi) {
        logTool("methodology_advisor", `${ent.mode}:phi_rejected`, startedAt);
        return jsonResult(phiRejection(phi));
      }

      const { pico, design, outcome_type, features, keywords } = parsed.value;
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
