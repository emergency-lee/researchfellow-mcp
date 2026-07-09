import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KB_VERSION, UPGRADE_URL } from "@/lib/version";
import { scanForPhi, phiRejection } from "@/lib/phi-guard";
import { scoreJournals, abstractDiagnostics, JOURNAL_KB_VERSION } from "@/lib/journals";
import { entitlementOf, jsonResult, logTool, type ToolExtra } from "@/lib/tools/shared";

// PH-1: title + abstract + keywords are de-identified manuscript metadata.
const inputSchema = {
  title: z.string().max(400).optional(),
  abstract: z.string().min(1).max(4000),
  keywords: z.array(z.string().max(80)).max(30).optional(),
  design: z.enum(["cohort", "case_control", "cross_sectional", "prediction"]).optional(),
};

export function registerJournalFit(server: McpServer) {
  server.registerTool(
    "journal_fit",
    {
      title: "Journal Fit",
      description:
        "Score a manuscript (title + abstract + keywords + design) against a curated set of target " +
        "journals for scope fit, and diagnose abstract format (structured labels, word limit). Full mode " +
        "returns the ranked candidates + format diagnostics for the best fit; teaser returns the top " +
        "candidate name only. De-identified manuscript metadata only (no PHI).",
      inputSchema,
    },
    async (args, extra: ToolExtra) => {
      const startedAt = Date.now();
      const ent = entitlementOf(extra);

      const phi = scanForPhi(args);
      if (phi) {
        logTool("journal_fit", `${ent.mode}:phi_rejected`, startedAt);
        return jsonResult(phiRejection(phi));
      }

      const ranked = scoreJournals(args);
      const top = ranked[0];

      if (ent.mode === "teaser") {
        logTool("journal_fit", "teaser", startedAt);
        return jsonResult({
          mode: "teaser",
          kb_version: KB_VERSION,
          journal_kb_version: JOURNAL_KB_VERSION,
          candidate_count: ranked.filter((r) => r.score > 0).length,
          top_candidate: top && top.score > 0 ? top.name : null,
          note: "full ranking, fit scores and abstract format diagnostics are in full mode",
          upgrade: {
            hint: "Per-Study Pass로 저널 랭킹·적합 점수·초록 형식 진단을 해제하세요.",
            url: UPGRADE_URL,
          },
        });
      }

      const diagnostics = top ? abstractDiagnostics(args.abstract, top.name) : null;

      logTool("journal_fit", "full", startedAt);
      return jsonResult({
        mode: "full",
        kb_version: KB_VERSION,
        journal_kb_version: JOURNAL_KB_VERSION,
        candidates: ranked.slice(0, 6),
        best_fit_diagnostics: diagnostics,
        note: "Scope fit is a heuristic from a small curated KB — confirm against the journal's current aims & scope.",
      });
    },
  );
}
