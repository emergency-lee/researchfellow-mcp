// In-memory fixed-window rate limiter — SECOND line of defence only. Serverless
// instances each hold their own window, so the effective global limit is
// (limit x instance count); the FIRST line is the Vercel WAF per-IP rule
// (docs/roadmap_2026-07-16.md v0.2 item 4, extended to /api/token|events).

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
