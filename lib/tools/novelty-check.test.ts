import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerNoveltyCheck } from "@/lib/tools/novelty-check";
import { searchPubmedWithFallback } from "@/lib/pubmed";

vi.mock("@/lib/pubmed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pubmed")>();
  return {
    ...actual,
    searchPubmedWithFallback: vi.fn(),
  };
});

const mockedSearch = vi.mocked(searchPubmedWithFallback);

type ToolHandler = (
  args: {
    pico: {
      population: string;
      exposure: string;
      comparator?: string;
      outcome: string;
      timeframe?: string;
    };
    keywords?: string[];
    known_pmids?: string[];
  },
  extra?: unknown,
) => Promise<{ content: Array<{ type: string; text: string }> }>;

function captureTool(): { name: string; handler: ToolHandler } {
  const box: { name?: string; handler?: ToolHandler } = {};
  const server = {
    registerTool: (n: string, _c: unknown, h: ToolHandler) => {
      box.name = n;
      box.handler = h;
    },
  } as unknown as McpServer;
  registerNoveltyCheck(server);
  if (!box.name || !box.handler) {
    throw new Error("registerNoveltyCheck did not register");
  }
  return { name: box.name, handler: box.handler };
}

const pico = {
  population: "adults with sepsis",
  exposure: "vitamin C",
  outcome: "28-day mortality",
};

function parsePayload(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

function hintsBlob(payload: Record<string, unknown>): string {
  const hints = payload.positioning_hints;
  return Array.isArray(hints) ? hints.join(" ") : JSON.stringify(payload);
}

describe("novelty_check handler", () => {
  afterEach(() => {
    mockedSearch.mockReset();
  });

  it("registers as novelty_check", () => {
    expect(captureTool().name).toBe("novelty_check");
  });

  it("maps upstream search failure to upstream_unavailable, not a zero-hit novelty claim", async () => {
    mockedSearch.mockResolvedValue({
      ok: false,
      queryUsed: "strict-query",
      articles: [],
      relaxed: false,
    });
    const { handler } = captureTool();
    const payload = parsePayload(await handler({ pico }));
    expect(payload.error).toBe("upstream_unavailable");
    expect(payload.similar).toBeUndefined();
    expect(payload.query_used).toBe("strict-query");
    expect(payload.relaxed).toBe(false);
    const blob = JSON.stringify(payload);
    expect(blob).not.toMatch(/novelty 근거/);
    expect(blob).not.toMatch(/시의성/);
  });

  it("treats legitimate zero hits as success with provenance, without claiming a literature gap", async () => {
    mockedSearch.mockResolvedValue({
      ok: true,
      queryUsed: "relaxed-query",
      articles: [],
      relaxed: true,
    });
    const { handler } = captureTool();
    const payload = parsePayload(await handler({ pico }));
    expect(payload.error).toBeUndefined();
    expect(payload.mode).toBe("full");
    expect(payload.similar).toEqual([]);
    expect(payload.relaxed).toBe(true);
    expect(payload.query_used).toBe("relaxed-query");
    expect(payload.search).toMatchObject({
      source: "pubmed_eutils",
      hit_count: 0,
      excluded_known_count: 0,
      candidate_count: 0,
      relaxed: true,
    });
    const blob = hintsBlob(payload);
    expect(blob).toMatch(/0건/);
    expect(blob).not.toMatch(/novelty 근거/);
    expect(blob).not.toMatch(/시의성/);
    expect(blob).toMatch(/단정하지 마세요/);
    expect(blob).toMatch(/완화/);
  });

  it("ranks mocked articles in full mode without unsupported gap claims", async () => {
    mockedSearch.mockResolvedValue({
      ok: true,
      queryUsed: "strict-query",
      relaxed: false,
      articles: [
        {
          pmid: "111",
          title: "Unrelated oncology chemotherapy trial",
          year: 2010,
          journal: "Other",
        },
        {
          pmid: "222",
          title: "Vitamin C in adults with sepsis and 28-day mortality",
          year: 2024,
          journal: "JAMA",
        },
      ],
    });
    const { handler } = captureTool();
    const payload = parsePayload(await handler({ pico }));
    expect(payload.mode).toBe("full");
    expect(payload.relaxed).toBe(false);
    expect(payload.search).toMatchObject({
      source: "pubmed_eutils",
      hit_count: 2,
      excluded_known_count: 0,
      candidate_count: 2,
      relaxed: false,
    });
    const similar = payload.similar as Array<{ pmid: string; hypothesis_direction: string }>;
    expect(similar.map((s) => s.pmid)).toEqual(["222", "111"]);
    expect(similar[0].hypothesis_direction).toBe("not_assessed");
    const blob = hintsBlob(payload);
    expect(blob).not.toMatch(/novelty 근거/);
    expect(blob).not.toMatch(/필드 전체의 공백으로 활용/);
  });

  it("does not claim a zero search when every retrieved paper is already in known_pmids", async () => {
    mockedSearch.mockResolvedValue({
      ok: true,
      queryUsed: "strict-query",
      relaxed: false,
      articles: [
        { pmid: "111", title: "Known paper one", year: 2020, journal: "A" },
        { pmid: "222", title: "Known paper two", year: 2021, journal: "B" },
      ],
    });
    const { handler } = captureTool();
    const payload = parsePayload(
      await handler({ pico, known_pmids: ["111", "222"] }),
    );
    expect(payload.mode).toBe("full");
    expect(payload.similar).toEqual([]);
    expect(payload.search).toMatchObject({
      source: "pubmed_eutils",
      hit_count: 2,
      excluded_known_count: 2,
      candidate_count: 0,
      relaxed: false,
    });
    const blob = hintsBlob(payload);
    expect(blob).toMatch(/known_pmids/);
    expect(blob).not.toMatch(/적중 문헌이 0건/);
    expect(blob).not.toMatch(/novelty 근거/);
  });

  it("keeps ranking of remaining papers when some retrieved PMIDs are already known", async () => {
    mockedSearch.mockResolvedValue({
      ok: true,
      queryUsed: "strict-query",
      relaxed: false,
      articles: [
        {
          pmid: "111",
          title: "Unrelated oncology chemotherapy trial",
          year: 2010,
          journal: "Other",
        },
        {
          pmid: "222",
          title: "Vitamin C in adults with sepsis and 28-day mortality",
          year: 2024,
          journal: "JAMA",
        },
      ],
    });
    const { handler } = captureTool();
    const payload = parsePayload(await handler({ pico, known_pmids: ["111"] }));
    expect(payload.search).toMatchObject({
      hit_count: 2,
      excluded_known_count: 1,
      candidate_count: 1,
    });
    const similar = payload.similar as Array<{ pmid: string }>;
    expect(similar.map((s) => s.pmid)).toEqual(["222"]);
    const blob = hintsBlob(payload);
    expect(blob).not.toMatch(/적중 문헌이 0건/);
    expect(blob).not.toMatch(/모두 이미 제공된 known_pmids/);
  });
});
