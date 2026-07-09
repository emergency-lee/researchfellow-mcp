import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KB_VERSION, UPGRADE_URL } from "@/lib/version";
import { scanForPhi, phiRejection } from "@/lib/phi-guard";
import { anticipateObjections, PLAYBOOK_VERSION } from "@/lib/reviewer-playbook";
import { entitlementOf, jsonResult, logTool, type ToolExtra } from "@/lib/tools/shared";

// Anticipated peer-reviewer objections + drafted responses (S5 revision support).
const inputSchema = {
  manuscript: z.string().min(1).max(60000),
  design: z.enum(["cohort", "case_control", "cross_sectional", "prediction"]).optional(),
};

export function registerReviewerPlaybook(server: McpServer) {
  server.registerTool(
    "reviewer_playbook",
    {
      title: "Reviewer Playbook",
      description:
        "Anticipate the methodological objections a peer reviewer of an observational study is most likely " +
        "to raise (confounding by indication, immortal time, competing risks, residual confounding, " +
        "multiplicity, Table 1 p-values, generalizability, causal overreach) and draft a response for each. " +
        "Full mode returns the objections + responses; teaser returns counts by likelihood. De-identified " +
        "manuscript text only (no PHI).",
      inputSchema,
    },
    async (args, extra: ToolExtra) => {
      const startedAt = Date.now();
      const ent = entitlementOf(extra);

      const phi = scanForPhi(args);
      if (phi) {
        logTool("reviewer_playbook", `${ent.mode}:phi_rejected`, startedAt);
        return jsonResult(phiRejection(phi));
      }

      const objections = anticipateObjections(args);
      const counts = objections.reduce(
        (acc, o) => ((acc[o.likelihood] = (acc[o.likelihood] ?? 0) + 1), acc),
        {} as Record<string, number>,
      );

      if (ent.mode === "teaser") {
        logTool("reviewer_playbook", "teaser", startedAt);
        return jsonResult({
          mode: "teaser",
          kb_version: KB_VERSION,
          playbook_version: PLAYBOOK_VERSION,
          objection_count: objections.length,
          by_likelihood: counts,
          top_topics: objections.slice(0, 3).map((o) => o.topic),
          note: "the full objections + drafted responses are in full mode",
          upgrade: {
            hint: "Per-Study Pass로 예상 지적 전문과 대응 초안을 해제하세요.",
            url: UPGRADE_URL,
          },
        });
      }

      logTool("reviewer_playbook", "full", startedAt);
      return jsonResult({
        mode: "full",
        kb_version: KB_VERSION,
        playbook_version: PLAYBOOK_VERSION,
        objection_count: objections.length,
        by_likelihood: counts,
        objections,
        note: "Anticipated objections from deterministic method signals — not a substitute for the actual reviews; use to pre-empt the obvious ones.",
      });
    },
  );
}
