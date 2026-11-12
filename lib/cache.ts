// Tiny in-memory caches. WONDER data updates rarely (annual vintages), so a
// generous TTL is safe. On Vercel this lives per-lambda instance; locally it
// lasts for the dev-server lifetime.
//
// Caches are created independently so that one cannot evict the other: the
// WONDER response cache and the AI-analysis cache have very different entry
// sizes and hit patterns, and sharing a single LRU let a burst of one throw
// away the other.

interface Entry<T> {
  value: T;
  expires: number;
}

export interface Cache<T> {
  get(key: string): T | undefined;
  /** `ttlMs` overrides the cache's default lifetime for this one entry. */
  set(key: string, value: T, ttlMs?: number): void;
  readonly size: number;
}

export function createCache<T>(options: { ttlMs: number; maxEntries: number }): Cache<T> {
  const store = new Map<string, Entry<T>>();
  return {
    get(key) {
      const e = store.get(key);
      if (!e) return undefined;
      if (Date.now() > e.expires) {
        store.delete(key);
        return undefined;
      }
      return e.value;
    },
    set(key, value, ttlMs = options.ttlMs) {
      // Re-setting a key must not evict a neighbour to make room for itself.
      store.delete(key);
      if (store.size >= options.maxEntries) {
        // Drop oldest entry (Map preserves insertion order).
        const first = store.keys().next().value;
        if (first !== undefined) store.delete(first);
      }
      store.set(key, { value, expires: Date.now() + ttlMs });
    },
    get size() {
      return store.size;
    },
  };
}

export function cacheKey(obj: unknown): string {
  return JSON.stringify(obj);
}

// How long a WONDER result stays good depends on which file it came from.
//
// A FINAL file (2018-2024, 1999-2020) changes about once a year, when CDC adds
// a year to it, so a week is conservative and means the example queries are
// almost always instant. The PROVISIONAL file is refreshed continuously, so
// anything that touches it (including the combined series) keeps the shorter
// life it always had.
export const FINAL_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
export const PROVISIONAL_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

// The WONDER response cache, used by app/api/wonder/route.ts. It holds whole
// responses and, under a "source:" prefix, the per-file tables a combined
// query is built from, so those survive to be reused by the next one.
const wonderCache = createCache<unknown>({
  ttlMs: PROVISIONAL_TTL_MS,
  maxEntries: 400,
});

export function cacheGet<T>(key: string): T | undefined {
  return wonderCache.get(key) as T | undefined;
}

export function cacheSet<T>(key: string, value: T, ttlMs?: number): void {
  wonderCache.set(key, value, ttlMs);
}
