import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KB_VERSION } from "@/lib/version";
import { scanForPhi, phiRejection } from "@/lib/phi-guard";
import {
  searchPubmedWithFallback,
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
        "Returns a ranked similar-study list and positioning hints. " +
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
      const search = await searchPubmedWithFallback(pico, keywords);
      const query = search.queryUsed;

      if (!search.ok) {
        // NFR-2: upstream failure is a normal result, not a hard error.
        logTool("novelty_check", `${ent.mode}:upstream_unavailable`, startedAt);
        return jsonResult({
          error: "upstream_unavailable",
          kb_version: KB_VERSION,
          query_used: query,
          relaxed: search.relaxed,
          search: {
            source: "pubmed_eutils",
            hit_count: null,
            relaxed: search.relaxed,
          },
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
      const retrievedCount = search.articles.length;
      const candidateCount = scored.length;
      const excludedKnownCount = retrievedCount - candidateCount;

      // ---- teaser: counts are TRUE (real search), content hidden (§0-3) ----
      if (ent.mode === "teaser") {
        logTool("novelty_check", "teaser", startedAt);
        return jsonResult({
          mode: "teaser",
          kb_version: KB_VERSION,
          similar_count: candidateCount,
          conflicting_count: null,
          most_recent_year: mostRecentYear,
          note: "conflicting 분석은 direction 인덱스 도입(P2) 후 제공",
        });
      }

      // ---- full ----
      const currentYear = new Date().getFullYear();
      const recentCount = years.filter(
        (y) => y >= currentYear - RECENT_WINDOW_YEARS,
      ).length;

      const positioningHints: string[] = [];
      if (retrievedCount === 0) {
        positioningHints.push(
          "이 검색에서 적중 문헌이 0건입니다. 검색 미적중을 문헌 공백이나 신규성으로 단정하지 마세요.",
        );
      } else if (candidateCount === 0) {
        positioningHints.push(
          `이 검색에서 적중 문헌이 ${retrievedCount}건이지만, 모두 이미 제공된 known_pmids입니다. 검색 미적중으로 보지 마세요.`,
        );
      } else if (recentCount > 0) {
        positioningHints.push(
          `이 검색에서 최근 ${RECENT_WINDOW_YEARS}년 내 적중 문헌이 ${recentCount}건입니다. 선행연구 대비 차별점(설계·집단·노출 정의)을 명시하세요.`,
        );
      } else {
        positioningHints.push(
          `이 검색의 남은 후보 ${candidateCount}건 중 최근 ${RECENT_WINDOW_YEARS}년 내 출판은 없습니다. 필드 전체의 공백으로 해석하지 마세요.`,
        );
      }
      const top = scored[0];
      if (top && top.similarity >= 0.5) {
        positioningHints.push(
          `가장 유사한 선행연구(PMID ${top.pmid}, 유사도 ${top.similarity})와의 방법론·결과 차이를 도입부에서 대조하세요.`,
        );
      }
      if (candidateCount > 0) {
        positioningHints.push(
          `이 검색의 남은 후보 ${candidateCount}건과 대비해 본 연구의 기여를 한 문장으로 정식화하세요.`,
        );
      }
      if (search.relaxed) {
        positioningHints.push("완화된 질의로 다시 검색한 결과입니다.");
      }

      logTool("novelty_check", "full", startedAt);
      return jsonResult({
        mode: "full",
        kb_version: KB_VERSION,
        query_used: query,
        relaxed: search.relaxed,
        search: {
          source: "pubmed_eutils",
          hit_count: retrievedCount,
          excluded_known_count: excludedKnownCount,
          candidate_count: candidateCount,
          relaxed: search.relaxed,
        },
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
