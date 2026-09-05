import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildQuery,
  buildRelaxedQuery,
  searchPubmed,
  searchPubmedWithFallback,
  tokenize,
  similarity,
} from "@/lib/pubmed";

const pico = {
  population: "adults with sepsis",
  exposure: "vitamin C",
  comparator: "placebo",
  outcome: "28-day mortality",
};

describe("buildQuery", () => {
  it("AND-joins quoted PICO phrases and OR-groups keywords", () => {
    const q = buildQuery(pico, ["ICU", "shock"]);
    expect(q).toContain('"adults with sepsis"');
    expect(q).toContain(" AND ");
    expect(q).toContain('("ICU" OR "shock")');
  });

  it("omits an absent comparator", () => {
    const q = buildQuery({ population: "a", exposure: "b", outcome: "c" });
    expect(q).not.toContain('""');
  });
});

describe("buildRelaxedQuery", () => {
  it("drops generic clinical stopwords and numeric prefixes", () => {
    const q = buildRelaxedQuery(pico);
    expect(q.toLowerCase()).not.toContain("patient");
    // "28-day" -> "day" -> dropped as a generic token
    expect(q.toLowerCase()).not.toMatch(/\bday\b/);
    expect(q.toLowerCase()).toContain("sepsis");
  });
});

describe("similarity", () => {
  it("is 0 for an empty query token set", () => {
    expect(similarity(new Set(), "anything here")).toBe(0);
  });

  it("normalizes overlap by query size and is bounded in [0,1]", () => {
    const q = tokenize("sepsis vitamin mortality");
    const s = similarity(q, "Vitamin C in sepsis and mortality outcomes");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it("gives 0 when nothing overlaps", () => {
    expect(similarity(tokenize("oncology chemotherapy"), "cardiac surgery outcomes")).toBe(0);
  });
});

describe("tokenize", () => {
  it("drops stopwords and short tokens", () => {
    const t = tokenize("the a of sepsis");
    expect(t.has("sepsis")).toBe(true);
    expect(t.has("the")).toBe(false);
    expect(t.has("of")).toBe(false);
  });
});

const ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const ESUMMARY = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";
const FAKE_KEY = "test-ncbi-key-not-a-secret";
const ORIGINAL_NCBI_KEY = process.env.NCBI_API_KEY;

function jsonOk(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function httpFail(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: "ignored" }),
  } as Response;
}

function esearchHits(ids: string[]) {
  return {
    header: { type: "esearch", version: "0.3" },
    esearchresult: {
      count: String(ids.length),
      retmax: String(ids.length),
      retstart: "0",
      idlist: ids,
    },
  };
}

function summaryRecord(
  id: string,
  fields: { title?: string; pubdate?: string; source?: string; fulljournalname?: string } = {},
) {
  return {
    uid: id,
    title: fields.title ?? `Title ${id}`,
    pubdate: fields.pubdate ?? "2023 Jan",
    source: fields.source ?? "JAMA",
    fulljournalname: fields.fulljournalname ?? "JAMA",
  };
}

function esummaryHits(ids: string[], records?: Record<string, unknown>) {
  const result: Record<string, unknown> = { uids: ids };
  for (const id of ids) {
    result[id] = records?.[id] ?? summaryRecord(id);
  }
  return { header: { type: "esummary", version: "0.3" }, result };
}

function urlOf(call: unknown): string {
  if (Array.isArray(call)) return String(call[0]);
  return String(call);
}

describe("searchPubmed (mocked fetch)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.NCBI_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (ORIGINAL_NCBI_KEY === undefined) delete process.env.NCBI_API_KEY;
    else process.env.NCBI_API_KEY = ORIGINAL_NCBI_KEY;
  });

  it("returns ordered articles from a valid esearch+esummary pair", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonOk(esearchHits(["23456789", "12345678"])))
      .mockResolvedValueOnce(
        jsonOk(
          esummaryHits(["23456789", "12345678"], {
            "23456789": summaryRecord("23456789", {
              title: "Later hit",
              pubdate: "2021",
              fulljournalname: "BMJ",
            }),
            "12345678": summaryRecord("12345678", {
              title: "First listed",
              pubdate: "2023 Jan",
              fulljournalname: "JAMA",
            }),
          }),
        ),
      );

    const result = await searchPubmed("sepsis vitamin");
    expect(result.ok).toBe(true);
    expect(result.queryUsed).toBe("sepsis vitamin");
    expect(result.articles.map((a) => a.pmid)).toEqual(["23456789", "12345678"]);
    expect(result.articles[0]).toMatchObject({
      title: "Later hit",
      year: 2021,
      journal: "BMJ",
    });
    expect(result.articles[1]).toMatchObject({
      title: "First listed",
      year: 2023,
      journal: "JAMA",
    });
  });

  it("treats a genuine empty idlist as success and skips esummary", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({
        header: { type: "esearch", version: "0.3" },
        esearchresult: { count: "0", retmax: "0", retstart: "0", idlist: [] },
      }),
    );
    const result = await searchPubmed("no such topic xyz");
    expect(result).toEqual({ ok: true, queryUsed: "no such topic xyz", articles: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchMock.mock.calls[0])).toContain("esearch.fcgi");
  });

  it("returns ok:false for {error:'API rate limit exceeded'}", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ error: "API rate limit exceeded" }));
    const result = await searchPubmed("sepsis");
    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns ok:false for esearchresult.ERROR", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ esearchresult: { ERROR: "Invalid db name specified" } }),
    );
    const result = await searchPubmed("sepsis");
    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
  });

  it.each([
    ["null body", null],
    ["string body", "oops"],
    ["array body", []],
    ["missing esearchresult", {}],
    ["null esearchresult", { esearchresult: null }],
    ["null idlist", { esearchresult: { idlist: null } }],
    ["string idlist", { esearchresult: { idlist: "1,2" } }],
    ["numeric ids", { esearchresult: { idlist: [12345678] } }],
    ["empty-string id", { esearchresult: { idlist: [""] } }],
    ["non-digit id", { esearchresult: { idlist: ["PMC123"] } }],
  ])("returns ok:false for malformed esearch (%s)", async (_label, body) => {
    fetchMock.mockResolvedValueOnce(jsonOk(body));
    const result = await searchPubmed("sepsis");
    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
  });

  it("returns ok:false for malformed esummary {error}", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonOk(esearchHits(["12345678"])))
      .mockResolvedValueOnce(jsonOk({ error: "Invalid uid" }));
    const result = await searchPubmed("sepsis");
    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
  });

  it("returns ok:false when esummary result is missing", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonOk(esearchHits(["12345678"])))
      .mockResolvedValueOnce(jsonOk({ header: { type: "esummary" } }));
    const result = await searchPubmed("sepsis");
    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
  });

  it("returns ok:false for a partial summary (requested id missing)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonOk(esearchHits(["12345678", "23456789"])))
      .mockResolvedValueOnce(
        jsonOk({
          result: {
            uids: ["12345678"],
            "12345678": summaryRecord("12345678"),
          },
        }),
      );
    const result = await searchPubmed("sepsis");
    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
  });

  it("returns ok:false for a per-record esummary error", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonOk(esearchHits(["12345678"])))
      .mockResolvedValueOnce(
        jsonOk({
          result: {
            uids: ["12345678"],
            "12345678": { uid: "12345678", error: "cannot get document summary" },
          },
        }),
      );
    const result = await searchPubmed("sepsis");
    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
  });

  it("returns ok:false for a result-level esummary error even if a record looks present", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonOk(esearchHits(["12345678"])))
      .mockResolvedValueOnce(
        jsonOk({
          result: {
            error: "cannot get document summary",
            uids: ["12345678"],
            "12345678": summaryRecord("12345678"),
          },
        }),
      );
    const result = await searchPubmed("sepsis");
    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
  });

  it.each([
    ["empty record", {}],
    ["numeric title", { uid: "12345678", title: 123 }],
    ["empty title", { uid: "12345678", title: "" }],
    ["whitespace title", { uid: "12345678", title: "   " }],
    ["missing title", { uid: "12345678", pubdate: "2023" }],
  ])("returns ok:false for malformed summary record (%s)", async (_label, rec) => {
    fetchMock
      .mockResolvedValueOnce(jsonOk(esearchHits(["12345678"])))
      .mockResolvedValueOnce(jsonOk({ result: { uids: ["12345678"], "12345678": rec } }));
    const result = await searchPubmed("sepsis");
    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
  });

  it("returns ok:false when summary uid does not match the requested id", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonOk(esearchHits(["12345678"])))
      .mockResolvedValueOnce(
        jsonOk({
          result: {
            uids: ["12345678"],
            "12345678": { uid: "99999999", title: "Mismatched uid title" },
          },
        }),
      );
    const result = await searchPubmed("sepsis");
    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
  });

  it("returns ok:false when summary uid is a number rather than the PMID string", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonOk(esearchHits(["12345678"])))
      .mockResolvedValueOnce(
        jsonOk({
          result: {
            uids: ["12345678"],
            "12345678": { uid: 12345678, title: "Numeric uid title" },
          },
        }),
      );
    const result = await searchPubmed("sepsis");
    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
  });

  it("accepts a valid record with optional journal/year omitted", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonOk(esearchHits(["12345678"])))
      .mockResolvedValueOnce(
        jsonOk({
          result: {
            uids: ["12345678"],
            "12345678": { uid: "12345678", title: "Title only" },
          },
        }),
      );
    const result = await searchPubmed("sepsis");
    expect(result.ok).toBe(true);
    expect(result.articles).toEqual([
      { pmid: "12345678", title: "Title only", year: null, journal: null },
    ]);
  });

  it("returns ok:false on HTTP non-OK", async () => {
    fetchMock.mockResolvedValueOnce(httpFail(429));
    const result = await searchPubmed("sepsis");
    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
  });

  it("returns ok:false on abort/timeout", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const pending = searchPubmed("sepsis");
    await vi.advanceTimersByTimeAsync(8000);
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
  });

  it("caps esummary requests to RETMAX and encodes ids", async () => {
    const ids = Array.from({ length: 45 }, (_, i) => String(10000000 + i));
    fetchMock
      .mockResolvedValueOnce(jsonOk(esearchHits(ids)))
      .mockResolvedValueOnce(jsonOk(esummaryHits(ids.slice(0, 40))));

    const result = await searchPubmed("sepsis");
    expect(result.ok).toBe(true);
    expect(result.articles).toHaveLength(40);
    expect(result.articles[0].pmid).toBe("10000000");
    expect(result.articles[39].pmid).toBe("10000039");

    const summaryUrl = urlOf(fetchMock.mock.calls[1]);
    expect(summaryUrl.startsWith(ESUMMARY)).toBe(true);
    const requested = new URL(summaryUrl).searchParams.get("id") ?? "";
    const requestedIds = requested.split(",");
    expect(requestedIds).toHaveLength(40);
    expect(requestedIds).toEqual(ids.slice(0, 40).map((id) => encodeURIComponent(id)));
    expect(requestedIds).not.toContain("10000040");
  });

  it("does not echo a stubbed NCBI_API_KEY in the result object", async () => {
    process.env.NCBI_API_KEY = FAKE_KEY;
    fetchMock.mockResolvedValueOnce(jsonOk({ error: "API rate limit exceeded", "api-key": FAKE_KEY }));
    const result = await searchPubmed("secret-query-term");
    const blob = JSON.stringify(result);
    expect(blob).not.toContain(FAKE_KEY);
    expect(result.ok).toBe(false);
    expect(urlOf(fetchMock.mock.calls[0])).toContain("esearch.fcgi");
  });

  it("does not treat malformed esearch as empty for fallback", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ error: "API rate limit exceeded" }));
    const result = await searchPubmedWithFallback(pico);
    expect(result.ok).toBe(false);
    expect(result.relaxed).toBe(false);
    expect(result.articles).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchMock.mock.calls[0])).toContain(ESEARCH);
  });
});
