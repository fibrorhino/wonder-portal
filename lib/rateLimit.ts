// A per-visitor cap on the two endpoints that spend the Gemini quota.
//
// The quota is one free-tier allowance shared by every visitor, so a single
// script (or one person leaning on a button) could use the whole day's worth
// and switch the feature off for everybody else. This does not make the
// allowance bigger; it stops any one address taking all of it.
//
// In memory and per process, like the response cache and the CDC pacing, which
// is right for the single always-on server this runs on. A restart forgets the
// counts, and that is fine: the point is to blunt a burst, not to keep books.
//
// Visitors behind one address (a classroom, a hospital network) share a
// bucket, which is why the limits are set well above what one person does.

export interface RateLimitRule {
  /** How many requests are allowed... */
  limit: number;
  /** ...in any window this long. */
  windowMs: number;
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export interface RateLimiter {
  /** Count one request from `key` and say whether it may go ahead. */
  take(key: string): RateLimitResult;
}

export function createRateLimiter(
  rules: RateLimitRule[],
  options: { maxKeys?: number; now?: () => number } = {},
): RateLimiter {
  const now = options.now ?? (() => Date.now());
  const maxKeys = options.maxKeys ?? 5000;
  const longest = Math.max(...rules.map((r) => r.windowMs));
  // Request times per visitor, oldest first.
  const seen = new Map<string, number[]>();

  return {
    take(key) {
      const t = now();
      const times = (seen.get(key) ?? []).filter((x) => t - x < longest);

      for (const rule of rules) {
        const inWindow = times.filter((x) => t - x < rule.windowMs);
        if (inWindow.length >= rule.limit) {
          // A refused request is not counted, so waiting really does clear it.
          seen.set(key, times);
          const freesAt = inWindow[inWindow.length - rule.limit] + rule.windowMs;
          return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((freesAt - t) / 1000)) };
        }
      }

      times.push(t);
      // Most recently active last, so the map can be trimmed from the front.
      seen.delete(key);
      seen.set(key, times);
      if (seen.size > maxKeys) {
        const oldest = seen.keys().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      return { ok: true };
    },
  };
}

/**
 * Who a request is from, for counting purposes. Cloudflare sets
 * CF-Connecting-IP on the way through the tunnel, and the app is reachable no
 * other way, so it can be trusted here. With no address at all, requests share
 * one bucket rather than each getting a free pass.
 */
export function visitorKey(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

/** "about 4 minutes", "about an hour": for the message shown to the visitor. */
export function waitPhrase(seconds: number): string {
  if (seconds < 90) return "about a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 55) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours <= 1 ? "about an hour" : `about ${hours} hours`;
}

// One shared limiter per feature, so the plain-English box and the analysis do
// not eat into each other's allowance.
const TEN_MINUTES = 10 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

/** /api/insights: only requests that actually reach Gemini are counted. */
export const analysisLimiter = createRateLimiter([
  { limit: 30, windowMs: TEN_MINUTES },
  { limit: 150, windowMs: ONE_DAY },
]);

/** /api/nl */
export const askLimiter = createRateLimiter([
  { limit: 40, windowMs: TEN_MINUTES },
  { limit: 200, windowMs: ONE_DAY },
]);
