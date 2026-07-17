// In-memory fixed-window rate limiter — SECOND line of defence only. Serverless
// instances each hold their own window (Map is process-local), so the effective
// global limit is (limit × instance count). This is intentional minimum defence;
// the FIRST line is Vercel WAF / edge per-IP rules (ops, outside this repo).
// Used by: /api/token, /api/events, and MCP tool path /api/[transport].

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const MAX_KEYS = 10_000; // memory backstop

export function checkRateLimit(
  key: string,
  opts: { max: number; windowMs: number },
): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now >= w.resetAt) {
    if (windows.size >= MAX_KEYS && !windows.has(key)) windows.clear();
    windows.set(key, { count: 1, resetAt: now + opts.windowMs });
    return true;
  }
  if (w.count >= opts.max) return false;
  w.count += 1;
  return true;
}

/** Test hook — reset all windows. */
export function _resetRateLimiter(): void {
  windows.clear();
}
