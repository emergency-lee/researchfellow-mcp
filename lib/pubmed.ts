// Live PubMed E-utilities client (KB-1 embedding index deferred to P1.5).
// Uses NCBI_API_KEY when present (higher rate limit) but works without it.

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const FETCH_TIMEOUT_MS = 8000;
const RETMAX = 40;
const PMID_RE = /^\d{1,16}$/;

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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasErrorField(v: Record<string, unknown>): boolean {
  return v.error != null || v.ERROR != null;
}

function parsePmid(v: unknown): string | null {
  return typeof v === "string" && PMID_RE.test(v) ? v : null;
}

/**
 * NCBI esearch JSON. Genuine empty idlist is success; any error/malformed
 * shape (including `{error:"API rate limit exceeded"}`) is failure.
 */
function parseIdList(payload: unknown): string[] | null {
  if (!isPlainObject(payload) || hasErrorField(payload)) return null;
  const result = payload.esearchresult;
  if (!isPlainObject(result) || hasErrorField(result)) return null;
  const idlist = result.idlist;
  if (!Array.isArray(idlist)) return null;
  const ids: string[] = [];
  for (const item of idlist) {
    const pmid = parsePmid(item);
    if (pmid === null) return null;
    ids.push(pmid);
  }
  return ids.slice(0, RETMAX);
}

function parseSummary(payload: unknown, ids: string[]): PubmedArticle[] | null {
  if (!isPlainObject(payload) || hasErrorField(payload)) return null;
  const result = payload.result;
  if (!isPlainObject(result) || hasErrorField(result)) return null;
  const articles: PubmedArticle[] = [];
  for (const id of ids) {
    const rec = result[id];
    if (!isPlainObject(rec) || hasErrorField(rec)) return null;
    if (rec.uid != null && rec.uid !== id) return null;
    const title = toStr(rec.title);
    if (title === null) return null;
    articles.push({
      pmid: id,
      title,
      year: parseYear(rec.pubdate),
      journal: toStr(rec.fulljournalname) ?? toStr(rec.source),
    });
  }
  return articles;
}

// No retry: esearch+esummary is already two calls; fallback can double that.
// FETCH_TIMEOUT_MS=8000 and NFR-1 p95<30s. Immediate 429 retry would worsen NCBI limits.
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

/**
 * Relaxed fallback: exact-phrase AND queries often return 0 on PubMed
 * (e.g. "adult sepsis patients"). Strip generic clinical stopwords and
 * AND-join the remaining significant tokens instead.
 */
const GENERIC_TOKENS = new Set([
  "adult", "adults", "patient", "patients", "use", "user", "users", "using",
  "treatment", "therapy", "day", "days", "rate", "risk", "study", "outcome",
  "outcomes", "effect", "effects", "impact", "association", "with", "without",
  "and", "or", "of", "in", "the", "a", "an",
]);

export function buildRelaxedQuery(
  pico: { population: string; exposure: string; comparator?: string; outcome: string },
  keywords?: string[],
): string {
  const tokens = new Set<string>();
  const fields = [pico.population, pico.exposure, pico.comparator, pico.outcome, ...(keywords ?? [])];
  for (const f of fields) {
    if (!f) continue;
    for (const raw of f.toLowerCase().split(/[^a-z0-9가-힣-]+/)) {
      const t = raw.replace(/^\d+-?/, "").trim(); // "28-day" -> "day" -> dropped
      if (t.length >= 3 && !GENERIC_TOKENS.has(t)) tokens.add(t);
    }
  }
  return [...tokens].join(" AND ");
}

/** Strict phrase query first; if it yields nothing, retry relaxed. */
export async function searchPubmedWithFallback(
  pico: { population: string; exposure: string; comparator?: string; outcome: string },
  keywords?: string[],
): Promise<PubmedResult & { relaxed: boolean }> {
  const strict = await searchPubmed(buildQuery(pico, keywords));
  if (!strict.ok || strict.articles.length > 0) return { ...strict, relaxed: false };
  const relaxedTerm = buildRelaxedQuery(pico, keywords);
  if (!relaxedTerm) return { ...strict, relaxed: false };
  const relaxed = await searchPubmed(relaxedTerm);
  return { ...relaxed, relaxed: true };
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

/** esearch -> esummary. Returns ok:false on any upstream/timeout/malformed failure. */
export async function searchPubmed(term: string): Promise<PubmedResult> {
  const fail: PubmedResult = { ok: false, queryUsed: term, articles: [] };
  try {
    const esearchUrl =
      `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance` +
      `&retmax=${RETMAX}&term=${encodeURIComponent(term)}${apiKeyParam()}`;
    const ids = parseIdList(await fetchJson(esearchUrl));
    if (ids === null) return fail;
    if (ids.length === 0) return { ok: true, queryUsed: term, articles: [] };

    const idParam = ids.map((id) => encodeURIComponent(id)).join(",");
    const esummaryUrl =
      `${EUTILS}/esummary.fcgi?db=pubmed&retmode=json` +
      `&id=${idParam}${apiKeyParam()}`;
    const articles = parseSummary(await fetchJson(esummaryUrl), ids);
    if (articles === null) return fail;
    return { ok: true, queryUsed: term, articles };
  } catch {
    return fail;
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
