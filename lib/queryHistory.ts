// Recent queries, per browser.
//
// A CDC query costs at least 15 seconds of waiting, so accidentally losing one
// you had already run is expensive. This keeps the last few specs in
// localStorage with a human label, so getting back to one is a click.
//
// localStorage only: a spec can describe a narrow demographic slice, and there
// is no reason for that to leave the user's machine. It is also why nothing
// here is sent to the server.

import type { QuerySpec } from "./wonder/types";
import { describeFilters, describeGrouping } from "./describeSpec";

const KEY = "wonderwall.history.v1";
const MAX = 10;

export interface HistoryEntry {
  /** Identity of the query — same spec, same id, so re-runs move rather than duplicate. */
  id: string;
  label: string;
  detail: string;
  at: number;
  spec: QuerySpec;
}

/**
 * Stable identity for a spec: same grouping, filters and measures = same query,
 * regardless of the order the user happened to click things in.
 */
function specId(spec: QuerySpec): string {
  const filters = Object.entries(spec.filters ?? {})
    .filter(([, v]) => v?.length)
    .map(([k, v]) => `${k}=${[...v].sort().join(",")}`)
    .sort()
    .join(";");
  return [
    spec.database,
    (spec.groupBy ?? []).join(">"),
    [...(spec.measures ?? [])].sort().join(","),
    filters,
  ].join("|");
}

function describe(spec: QuerySpec): { label: string; detail: string } {
  const grouping = describeGrouping(spec);
  return {
    label: grouping ? `By ${grouping}` : "Ungrouped query",
    detail: describeFilters(spec),
  };
}

export function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Stored data can be from an older shape; keep only what still reads as an entry.
    return parsed.filter(
      (e): e is HistoryEntry =>
        e &&
        typeof e.id === "string" &&
        typeof e.label === "string" &&
        e.spec &&
        Array.isArray(e.spec.groupBy),
    );
  } catch {
    // Private mode, cleared storage, or corrupt JSON — history is a convenience.
    return [];
  }
}

/** Record a spec as most recent and return the new list. */
export function recordQuery(spec: QuerySpec): HistoryEntry[] {
  const id = specId(spec);
  const { label, detail } = describe(spec);
  const entry: HistoryEntry = { id, label, detail, at: Date.now(), spec };
  const next = [entry, ...loadHistory().filter((e) => e.id !== id)].slice(0, MAX);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked — the in-memory list is still correct */
  }
  return next;
}

export function clearHistory(): HistoryEntry[] {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
  return [];
}

/** "just now" / "12m ago" / "3h ago" / "2d ago" */
export function relativeTime(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
