// Live PubMed E-utilities client (KB-1 embedding index deferred to P1.5).
// Uses NCBI_API_KEY when present (higher rate limit) but works without it.

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const FETCH_TIMEOUT_MS = 8000;
const RETMAX = 40;

export interface PubmedArticle {
  pmid: string;
  title: string;
  year: number | null;
  journal: string | null;
}

export interface PubmedResult {
  ok: boolean;
  queryUsed: string;
  articles: PubmedArticle[];
}

function apiKeyParam(): string {
  const k = process.env.NCBI_API_KEY?.trim();
  return k ? `&api_key=${encodeURIComponent(k)}` : "";
}

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "ResearchFellow-MCP/0.1 (novelty_check)" },
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Build a PubMed query term from PICO + keywords. P/E/C/O phrases are AND-joined;
 * keywords are OR-grouped and AND-appended. Kept deliberately simple for P1.
 */
export function buildQuery(
  pico: {
    population: string;
    exposure: string;
    comparator?: string;
    outcome: string;
    timeframe?: string;
  },
  keywords?: string[],
): string {
  const phrase = (s: string) => `"${s.replace(/"/g, " ").trim()}"`;
  const core = [pico.population, pico.exposure, pico.comparator, pico.outcome]
    .filter((s): s is string => Boolean(s && s.trim()))
    .map(phrase);
  let term = core.join(" AND ");
  const kw = (keywords ?? []).map((k) => k.trim()).filter(Boolean);
  if (kw.length) term += ` AND (${kw.map(phrase).join(" OR ")})`;
  return term;
}

function toStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function parseYear(pubdate: unknown): number | null {
  const s = toStr(pubdate);
  if (!s) return null;
  const m = /(\d{4})/.exec(s);
  return m ? Number(m[1]) : null;
}

/** esearch -> esummary. Returns ok:false on any upstream/timeout failure. */
export async function searchPubmed(term: string): Promise<PubmedResult> {
  const empty: PubmedResult = { ok: false, queryUsed: term, articles: [] };
  try {
    const esearchUrl =
      `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance` +
      `&retmax=${RETMAX}&term=${encodeURIComponent(term)}${apiKeyParam()}`;
    const search = (await fetchJson(esearchUrl)) as {
      esearchresult?: { idlist?: string[] };
    };
    const ids = search?.esearchresult?.idlist ?? [];
    if (!ids.length) return { ok: true, queryUsed: term, articles: [] };

    const esummaryUrl =
      `${EUTILS}/esummary.fcgi?db=pubmed&retmode=json` +
      `&id=${ids.join(",")}${apiKeyParam()}`;
    const summary = (await fetchJson(esummaryUrl)) as {
      result?: Record<string, unknown>;
    };
    const result = summary?.result ?? {};

    const articles: PubmedArticle[] = [];
    for (const id of ids) {
      const rec = result[id] as
        | { title?: unknown; pubdate?: unknown; fulljournalname?: unknown; source?: unknown }
        | undefined;
      if (!rec) continue;
      articles.push({
        pmid: id,
        title: toStr(rec.title) ?? "",
        year: parseYear(rec.pubdate),
        journal: toStr(rec.fulljournalname) ?? toStr(rec.source),
      });
    }
    return { ok: true, queryUsed: term, articles };
  } catch {
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Deterministic term-overlap similarity (P1). Embedding KB is P1.5.
// ---------------------------------------------------------------------------
const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "on", "for", "and", "or", "to", "with", "by",
  "at", "from", "as", "is", "are", "be", "vs", "versus", "study", "trial",
  "patients", "patient", "effect", "effects", "among", "using", "based",
]);

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

/** Overlap of query tokens present in the title, normalised by query size. */
export function similarity(queryTokens: Set<string>, title: string): number {
  if (queryTokens.size === 0) return 0;
  const t = tokenize(title);
  let hits = 0;
  for (const q of queryTokens) if (t.has(q)) hits++;
  return Math.round((hits / queryTokens.size) * 1000) / 1000;
}
