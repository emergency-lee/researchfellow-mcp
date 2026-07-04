import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KB_VERSION, UPGRADE_URL } from "@/lib/version";
import { scanForPhi, phiRejection } from "@/lib/phi-guard";
import {
  buildQuery,
  searchPubmed,
  similarity,
  tokenize,
  type PubmedArticle,
} from "@/lib/pubmed";
import {
  entitlementOf,
  jsonResult,
  logTool,
  type ToolExtra,
} from "@/lib/tools/shared";

// PH-1: structured PICO only — NO free-form tabular data fields.
const inputSchema = {
  pico: z.object({
    population: z.string().min(1).max(200),
    exposure: z.string().min(1).max(200),
    comparator: z.string().max(200).optional(),
    outcome: z.string().min(1).max(200),
    timeframe: z.string().max(120).optional(),
  }),
  keywords: z.array(z.string().max(80)).max(20).optional(),
  known_pmids: z.array(z.string().max(20)).max(100).optional(),
};

const RECENT_WINDOW_YEARS = 3;

export function registerNoveltyCheck(server: McpServer) {
  server.registerTool(
    "novelty_check",
    {
      title: "Novelty Check",
      description:
        "Cross-check a study idea (PICO + keywords) against live PubMed for similar prior work. " +
        "Full mode returns a ranked similar-study list and positioning hints; teaser returns counts only. " +
        "Accepts de-identified structured input only (no tabular/PHI data).",
      inputSchema,
    },
    async (args, extra: ToolExtra) => {
      const startedAt = Date.now();
      const ent = entitlementOf(extra);

      // PH-2: runtime PHI defence. Reject WITHOUT logging the payload.
      const phi = scanForPhi(args);
      if (phi) {
        logTool("novelty_check", `${ent.mode}:phi_rejected`, startedAt);
        return jsonResult(phiRejection(phi));
      }

      const { pico, keywords, known_pmids } = args;
      const query = buildQuery(pico, keywords);
      const search = await searchPubmed(query);

      if (!search.ok) {
        // NFR-2: upstream failure is a normal result, not a hard error.
        logTool("novelty_check", `${ent.mode}:upstream_unavailable`, startedAt);
        return jsonResult({
          error: "upstream_unavailable",
          kb_version: KB_VERSION,
          query_used: query,
          guidance:
            "PubMed 검색을 완료하지 못했습니다(타임아웃/네트워크). 잠시 후 다시 시도하세요.",
        });
      }

      const known = new Set((known_pmids ?? []).map((p) => p.trim()));
      const queryTokens = tokenize(
        [
          pico.population,
          pico.exposure,
          pico.comparator ?? "",
          pico.outcome,
          ...(keywords ?? []),
        ].join(" "),
      );

      const scored = search.articles
        .filter((a) => !known.has(a.pmid))
        .map((a: PubmedArticle) => ({
          pmid: a.pmid,
          title: a.title,
          year: a.year,
          journal: a.journal,
          similarity: similarity(queryTokens, a.title),
        }))
        .sort((x, y) => y.similarity - x.similarity);

      const years = scored
        .map((s) => s.year)
        .filter((y): y is number => typeof y === "number");
      const mostRecentYear = years.length ? Math.max(...years) : null;
      const similarCount = scored.length;

      // ---- teaser: counts are TRUE (real search), content hidden (§0-3) ----
      if (ent.mode === "teaser") {
        logTool("novelty_check", "teaser", startedAt);
        return jsonResult({
          mode: "teaser",
          kb_version: KB_VERSION,
          similar_count: similarCount,
          conflicting_count: null,
          most_recent_year: mostRecentYear,
          note: "conflicting 분석은 direction 인덱스 도입(P2) 후 제공",
          upgrade: {
            hint: "Per-Study Pass로 유사 논문 목록·유사도·포지셔닝 제안을 해제하세요.",
            url: UPGRADE_URL,
          },
        });
      }

      // ---- full ----
      const currentYear = new Date().getFullYear();
      const recentCount = years.filter(
        (y) => y >= currentYear - RECENT_WINDOW_YEARS,
      ).length;

      const positioningHints: string[] = [];
      if (recentCount > 0) {
        positioningHints.push(
          `최근 ${RECENT_WINDOW_YEARS}년 내 유사 연구 ${recentCount}건 — 선행연구 대비 차별점(설계·집단·노출 정의)을 명시할 것.`,
        );
      } else {
        positioningHints.push(
          `최근 ${RECENT_WINDOW_YEARS}년 내 직접 유사 연구가 적음 — 시의성·공백을 novelty 근거로 활용할 것.`,
        );
      }
      const top = scored[0];
      if (top && top.similarity >= 0.5) {
        positioningHints.push(
          `가장 유사한 선행연구(PMID ${top.pmid}, 유사도 ${top.similarity})와의 방법론·결과 차이를 도입부에서 대조할 것.`,
        );
      }
      positioningHints.push(
        `총 ${similarCount}건의 관련 문헌 대비 본 연구의 기여(신규 노출·하위집단·장기추적 등)를 한 문장으로 정식화할 것.`,
      );

      logTool("novelty_check", "full", startedAt);
      return jsonResult({
        mode: "full",
        kb_version: KB_VERSION,
        query_used: query,
        similar: scored.slice(0, 20).map((s) => ({
          pmid: s.pmid,
          title: s.title,
          year: s.year,
          journal: s.journal,
          similarity: s.similarity,
          hypothesis_direction: "not_assessed",
        })),
        positioning_hints: positioningHints,
        note: "hypothesis direction 분석은 P2 (큐레이션 인덱스 필요)",
      });
    },
  );
}
