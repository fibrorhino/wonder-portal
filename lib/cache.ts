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
  set(key: string, value: T): void;
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
    set(key, value) {
      if (store.size >= options.maxEntries) {
        // Drop oldest entry (Map preserves insertion order).
        const first = store.keys().next().value;
        if (first !== undefined) store.delete(first);
      }
      store.set(key, { value, expires: Date.now() + options.ttlMs });
    },
    get size() {
      return store.size;
    },
  };
}

export function cacheKey(obj: unknown): string {
  return JSON.stringify(obj);
}

// The WONDER response cache, used by app/api/wonder/route.ts.
const wonderCache = createCache<unknown>({
  ttlMs: 1000 * 60 * 60 * 12, // 12 hours
  maxEntries: 200,
});

export function cacheGet<T>(key: string): T | undefined {
  return wonderCache.get(key) as T | undefined;
}

export function cacheSet<T>(key: string, value: T): void {
  wonderCache.set(key, value);
}
