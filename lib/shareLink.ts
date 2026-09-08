// Shareable query links.
//
// A result is only useful to a colleague if they can get back to it. The whole
// QuerySpec is small, so it travels in the URL fragment rather than needing any
// server-side state: paste the link, the builder restores, the query runs.
//
// The fragment (not the query string) keeps the spec out of server logs and out
// of the Cloudflare analytics beacon, which matters because a spec can describe
// a narrow demographic slice.

import type { QuerySpec } from "./wonder/types";

const PARAM = "q";

/** URL-safe base64 (no padding), so the link survives chat clients and email. */
function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeSpec(spec: QuerySpec): string {
  return toBase64Url(JSON.stringify(spec));
}

/**
 * Decode a spec from a link. Shape-checked only — a link can be edited by hand
 * or go stale, and /api/wonder is the authority on whether a spec is runnable,
 * so this just refuses anything that is not recognisably a QuerySpec.
 */
export function decodeSpec(encoded: string): QuerySpec | null {
  try {
    const raw = JSON.parse(fromBase64Url(encoded)) as unknown;
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    if (!Array.isArray(o.groupBy) || !Array.isArray(o.measures)) return null;
    if (typeof o.filters !== "object" || o.filters === null) return null;
    return {
      database: typeof o.database === "string" ? o.database : "D158",
      groupBy: o.groupBy.filter((k): k is string => typeof k === "string").slice(0, 5),
      measures: o.measures.filter((m): m is QuerySpec["measures"][number] =>
        ["deaths", "population", "crudeRate", "ageAdjustedRate"].includes(m as string),
      ),
      filters: Object.fromEntries(
        Object.entries(o.filters as Record<string, unknown>)
          .filter(([, v]) => Array.isArray(v))
          .map(([k, v]) => [k, (v as unknown[]).map(String)]),
      ),
      options: (typeof o.options === "object" && o.options !== null
        ? o.options
        : {}) as QuerySpec["options"],
    };
  } catch {
    return null;
  }
}

/** Absolute link to the current page carrying this spec. */
export function shareUrl(spec: QuerySpec): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${PARAM}=${encodeSpec(spec)}`;
}

/** Spec carried by the current URL fragment, if any. */
export function specFromLocation(): QuerySpec | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  const value = new URLSearchParams(hash).get(PARAM);
  return value ? decodeSpec(value) : null;
}

/** Reflect a spec into the address bar without adding a history entry. */
export function updateLocation(spec: QuerySpec) {
  if (typeof window === "undefined") return;
  window.history.replaceState(null, "", `#${PARAM}=${encodeSpec(spec)}`);
}
