import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KB_VERSION } from "@/lib/version";
import { scanForPhi, phiRejection } from "@/lib/phi-guard";
import { critiqueManuscript, CRITIQUE_VERSION, type CritiqueIssue } from "@/lib/checklist-critique";
import { entitlementOf, jsonResult, logTool, type ToolExtra } from "@/lib/tools/shared";

// The paid depth counterpart to the plugin's free checklist_map.py coverage
// screen: per-item quality critique, not just presence/absence.
const inputSchema = {
  manuscript: z.string().min(1).max(60000),
  design: z.enum(["cohort", "case_control", "cross_sectional", "prediction"]).optional(),
  routinely_collected: z.boolean().optional(),
};

export function registerChecklistMap(server: McpServer) {
  server.registerTool(
    "checklist_map",
    {
      title: "Checklist Map (deep review)",
      description:
        "Deep reporting-guideline critique of a manuscript draft. Beyond the free local coverage screen, " +
        "this flags per-item quality gaps (e.g. an estimate without a CI, a relative effect without an " +
        "absolute one, code definitions without validation, causal language in an observational design) " +
        "with actionable fixes and the full issue list. " +
        "De-identified manuscript text only (no PHI).",
      inputSchema,
    },
    async (args, extra: ToolExtra) => {
      const startedAt = Date.now();
      const ent = entitlementOf(extra);

      const phi = scanForPhi(args);
      if (phi) {
        logTool("checklist_map", `${ent.mode}:phi_rejected`, startedAt);
        return jsonResult(phiRejection(phi));
      }

      const issues = critiqueManuscript(args);
      const counts = issues.reduce(
        (acc, i: CritiqueIssue) => ((acc[i.severity] = (acc[i.severity] ?? 0) + 1), acc),
        {} as Record<string, number>,
      );

      if (ent.mode === "teaser") {
        logTool("checklist_map", "teaser", startedAt);
        return jsonResult({
          mode: "teaser",
          kb_version: KB_VERSION,
          critique_version: CRITIQUE_VERSION,
          issue_count: issues.length,
          by_severity: counts,
          note: "the specific issues and suggested fixes are in full mode; the plugin's local checklist_map.py gives free coverage",
        });
      }

      logTool("checklist_map", "full", startedAt);
      return jsonResult({
        mode: "full",
        kb_version: KB_VERSION,
        critique_version: CRITIQUE_VERSION,
        issue_count: issues.length,
        by_severity: counts,
        issues,
        note: "Deterministic per-item critique — absence of an issue is not proof of good reporting; pairs with the free local coverage screen.",
      });
    },
  );
}
