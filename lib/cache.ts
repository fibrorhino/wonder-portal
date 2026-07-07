// Tiny in-memory cache keyed by QuerySpec hash. WONDER data updates rarely
// (annual vintages), so a generous TTL is safe. On Vercel this lives per-lambda
// instance; locally it lasts for the dev-server lifetime.

interface Entry<T> {
  value: T;
  expires: number;
}

const store = new Map<string, Entry<unknown>>();
const TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const MAX_ENTRIES = 200;

export function cacheKey(obj: unknown): string {
  return JSON.stringify(obj);
}

export function cacheGet<T>(key: string): T | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expires) {
    store.delete(key);
    return undefined;
  }
  return e.value as T;
}

export function cacheSet<T>(key: string, value: T): void {
  if (store.size >= MAX_ENTRIES) {
    // Drop oldest entry (Map preserves insertion order).
    const first = store.keys().next().value;
    if (first !== undefined) store.delete(first);
  }
  store.set(key, { value, expires: Date.now() + TTL_MS });
}
