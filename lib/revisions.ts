// Tracking how much provisional data moves.
//
// The provisional file is refreshed continuously, and the counts in it climb as
// death certificates are processed. Everyone is told this and nobody has a feel
// for the size of it — whether last month's 2025 figure was short by two hundred
// deaths or two thousand. That number is knowable: it is the difference between
// what the same query returned then and what it returns now.
//
// So each time a provisional query goes out to CDC, the per-period counts are
// recorded. When the same query runs again and the counts have moved, the
// difference is reported. Nothing is estimated; this is one observation minus
// another.
//
// Two deliberate limits:
//
// ONLY SINGLE TIME-DIMENSION TABLES. A table grouped by year AND method has
// several rows per period, and comparing those across vintages means either
// matching rows (which breaks when a category appears or disappears) or summing
// them (which is wrong when suppression differs between the two observations).
// Both are silently wrong in a way the reader could not detect, so such tables
// are not tracked at all.
//
// ONLY PROVISIONAL DATABASES. Final files do not move, and recording them would
// be storage spent on rows that never change.
//
// Storage follows lib/queryLog.ts: append-only JSONL under logs/, readable in a
// text editor, and a write failure must never break a query.

import { appendFile, readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { QuerySpec, ResultTable } from "./wonder/types";
import { cellLabel, cellNumber } from "./tableUtils";

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "revisions.jsonl");

export interface PeriodCount {
  period: string;
  deaths: number;
}

export interface RevisionChange {
  period: string;
  before: number;
  after: number;
  delta: number;
  /** Percent change, or null when the earlier figure was zero. */
  pct: number | null;
}

export interface RevisionReport {
  /** When the figures being compared against were observed, ISO. */
  previousObservedAt: string;
  changes: RevisionChange[];
}

interface Snapshot {
  key: string;
  at: string;
  figures: PeriodCount[];
}

/**
 * A stable identity for "the same query asked again".
 *
 * Display options are excluded: showing totals or hiding suppressed rows does
 * not change what CDC counted, and including them would split one question's
 * history across several keys.
 */
export function revisionKey(spec: QuerySpec): string {
  const filters = Object.entries(spec.filters ?? {})
    .filter(([, v]) => v?.length)
    // Year is excluded on purpose: asking for 2025 alone and asking for
    // 1999-2026 both observe 2025, and both should count as observations of it.
    .filter(([k]) => k !== "year")
    .map(([k, v]) => `${k}=${[...v].sort().join(",")}`)
    .sort()
    .join("&");
  const shape = `${spec.database}|${spec.groupBy.join(",")}|${filters}|${spec.options?.ratePer ?? 100000}`;
  return createHash("sha256").update(shape).digest("hex").slice(0, 16);
}

/** Time dimensions a period label can be built from. */
const TIME_KEYS = new Set(["year", "month"]);

/**
 * Per-period death counts, or null when this table cannot be compared safely.
 *
 * Returns null unless every grouping variable is a time variable — see the note
 * at the top about why a partially-matched comparison is worse than none.
 */
export function periodCounts(spec: QuerySpec, table: ResultTable): PeriodCount[] | null {
  if (spec.groupBy.length === 0) return null;
  if (!spec.groupBy.every((k) => TIME_KEYS.has(k))) return null;

  const dims = table.columns.map((c, i) => ({ c, i })).filter((x) => x.c.kind === "dimension");
  const deathsIdx = table.columns.findIndex((c) => c.measureKey === "deaths");
  if (dims.length === 0 || deathsIdx < 0) return null;

  const out: PeriodCount[] = [];
  for (let i = 0; i < table.rows.length; i++) {
    if (table.rowIsTotal[i]) continue;
    const row = table.rows[i];
    const deaths = cellNumber(row[deathsIdx]);
    // A suppressed period has no count to compare. Skipping it is right, and it
    // cannot silently become a zero.
    if (deaths === null) continue;
    out.push({ period: dims.map((d) => cellLabel(row[d.i])).join(" "), deaths });
  }
  return out.length > 0 ? out : null;
}

let cache: Map<string, Snapshot> | null = null;
let warned = false;

async function loadAll(): Promise<Map<string, Snapshot>> {
  if (cache) return cache;
  const map = new Map<string, Snapshot>();
  try {
    const text = await readFile(LOG_FILE, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const snap = JSON.parse(line) as Snapshot;
        // Later lines win: the file is append-only and in chronological order.
        if (snap?.key) map.set(snap.key, snap);
      } catch {
        // One corrupt line must not discard the rest of the history.
      }
    }
  } catch {
    // No file yet is the normal first-run case.
  }
  cache = map;
  return map;
}

function diff(before: PeriodCount[], after: PeriodCount[]): RevisionChange[] {
  const prior = new Map(before.map((p) => [p.period, p.deaths]));
  const changes: RevisionChange[] = [];
  for (const now of after) {
    const then = prior.get(now.period);
    // A period absent from the earlier observation is new, not revised.
    if (then === undefined || then === now.deaths) continue;
    changes.push({
      period: now.period,
      before: then,
      after: now.deaths,
      delta: now.deaths - then,
      pct: then > 0 ? ((now.deaths - then) / then) * 100 : null,
    });
  }
  return changes;
}

/**
 * Record this observation and report what moved since the last one.
 *
 * @returns null on the first observation of a query, when nothing changed, or
 *   when anything at all goes wrong — this is a nicety, and it must never be
 *   the reason a query fails.
 */
export async function observe(
  spec: QuerySpec,
  table: ResultTable,
  now: Date = new Date(),
): Promise<RevisionReport | null> {
  try {
    const figures = periodCounts(spec, table);
    if (!figures) return null;

    const key = revisionKey(spec);
    const map = await loadAll();
    const previous = map.get(key);
    const changes = previous ? diff(previous.figures, figures) : [];

    // Append only on a first sighting or when something actually moved. A query
    // run twice in a minute must not add a line each time.
    if (!previous || changes.length > 0) {
      const snap: Snapshot = { key, at: now.toISOString(), figures };
      try {
        mkdirSync(LOG_DIR, { recursive: true });
        await appendFile(LOG_FILE, JSON.stringify(snap) + "\n", "utf8");
        map.set(key, snap);
      } catch (err) {
        if (!warned) {
          warned = true;
          console.error("[revisions] could not write history:", err);
        }
      }
    }

    if (!previous || changes.length === 0) return null;
    return { previousObservedAt: previous.at, changes };
  } catch {
    return null;
  }
}

/** Drop the in-memory index. Tests only. */
export function resetCacheForTests(): void {
  cache = null;
}

// Re-exported so server callers have one import. The implementation lives in
// revisionsText.ts, which has no node:fs dependency and so is safe on the client.
export { describeRevisions } from "./revisionsText";
