// Running a query against a stitched series.
//
// One query against the composite becomes one query per source database, each
// asked only for the years it covers, and the results are joined. CDC enforces
// fifteen seconds between requests, so this is genuinely slow — two or three
// calls, in series, by necessity.
//
// The age-adjusted rate needs its own paragraph. The provisional file does not
// publish one, so if the query asks for it, that source is queried a SECOND
// time with age added to the grouping, and the rate is computed from those
// strata against the 2000 US standard population. That is one more call again,
// and it is only done when it can actually work: when the user asked for the
// measure, when the query is not already grouped by age, and when there is a
// spare grouping slot.

import type { QuerySpec, ResultCell, ResultTable } from "./types";
import { cellLabel, cellNumber } from "../tableUtils";
import { getDatabase } from "./db/registry";
import { yearsForSource, type CompositeSource } from "./db/combined";
import {
  ensureMeasureColumn,
  spliceAdjustedRates,
  stitchTables,
  type StitchSource,
} from "./stitch";
import { ageAdjustedRate, type AgeStratum } from "../stats/ageAdjust";
import { ageAdjustedBlocker } from "./buildRequest";

type Outcome =
  | { ok: true; table: ResultTable }
  // `detail` is the raw cause, for the log; `error` is what the visitor reads.
  | { ok: false; error: string; status: number; detail?: string };

export type FetchTable = (spec: QuerySpec) => Promise<Outcome>;

/**
 * The years CDC refused, read from its own message: "Invalid 'Year/Month'
 * codes were found: '2027'. Check the Finder Tool for valid Year/Month codes."
 *
 * The combined series runs "to the present", and the present is taken from the
 * calendar. CDC's provisional file is not: for the first weeks of each January
 * it has no rows for the new year, and it refuses a request that names one.
 * Since the composite always names its years, every combined query would fail
 * from New Year's Day until CDC caught up. Instead the years CDC says it does
 * not have are dropped and that source is asked once more.
 */
export function yearsCdcRejected(message: string): string[] {
  const m = /Invalid 'Year\/Month' codes were found:\s*([^.]*)\./i.exec(message);
  if (!m) return [];
  return [...m[1].matchAll(/'(\d{4})'/g)].map((x) => x[1]);
}

// Remembered so the lesson is not paid for again (a refusal still costs a
// fifteen-second slot), but not for long: the year appears as soon as CDC
// loads it.
const MISSING_TTL_MS = 6 * 60 * 60 * 1000;
const missingYears = new Map<string, { years: string[]; expires: number }>();

function knownMissing(databaseId: string): string[] {
  const entry = missingYears.get(databaseId);
  if (!entry) return [];
  if (Date.now() > entry.expires) {
    missingYears.delete(databaseId);
    return [];
  }
  return entry.years;
}

function rememberMissing(databaseId: string, years: string[]): void {
  missingYears.set(databaseId, { years, expires: Date.now() + MISSING_TTL_MS });
}

/** Test seam. */
export function __forgetMissingYearsForTests(): void {
  missingYears.clear();
}

/** `spec` with these years removed from its year filter. */
function withoutYears(spec: QuerySpec, years: string[]): QuerySpec {
  if (years.length === 0) return spec;
  const kept = (spec.filters.year ?? []).filter((y) => !years.includes(y));
  // Never empty the list: no year filter at all means "every year", which is
  // the opposite of what was asked for.
  if (kept.length === 0) return spec;
  return { ...spec, filters: { ...spec.filters, year: kept } };
}

/** The spec to send to one source: its own database, its own slice of years. */
function specForSource(spec: QuerySpec, source: CompositeSource, allYears: string[]): QuerySpec {
  const db = getDatabase(source.databaseId);
  const years = yearsForSource(source, spec.filters?.year, allYears);
  return {
    ...spec,
    database: db.id,
    // Only measures this source can actually return; the age-adjusted rate is
    // filled in afterwards for the one that cannot.
    measures: spec.measures.filter((m) => db.measures.includes(m)),
    filters: { ...spec.filters, year: years },
  };
}

export async function runComposite(
  spec: QuerySpec,
  sources: CompositeSource[],
  fetchTable: FetchTable,
): Promise<Outcome> {
  const allYears = getDatabase(spec.database).years;
  const wanted = sources
    .map((source) => ({ source, years: yearsForSource(source, spec.filters?.year, allYears) }))
    .filter((s) => s.years.length > 0);

  if (wanted.length === 0) {
    return { ok: false, error: "No years were selected.", status: 400 };
  }

  const parts: StitchSource[] = [];
  const computedYears: string[] = [];
  for (const { source } of wanted) {
    let sub = withoutYears(specForSource(spec, source, allYears), knownMissing(source.databaseId));
    let res = await fetchTable(sub);
    // A year the source does not have yet. See yearsCdcRejected.
    const rejected = res.ok ? [] : yearsCdcRejected(res.detail ?? res.error);
    if (!res.ok && rejected.length > 0) {
      const retry = withoutYears(sub, rejected);
      if ((retry.filters.year ?? []).length > 0) {
        rememberMissing(source.databaseId, rejected);
        sub = retry;
        res = await fetchTable(sub);
      }
    }
    if (!res.ok) {
      // One source failing makes the series wrong rather than short, so the
      // whole thing fails and says which part broke.
      return {
        ok: false,
        error: `${getDatabase(source.databaseId).label}: ${res.error}`,
        status: res.status,
        detail: res.detail ? `${source.databaseId} ${res.detail}` : undefined,
      };
    }
    let table = res.table;

    // Fill in an age-adjusted rate the source could not supply. The column has
    // to exist first: without it the computed values have nowhere to go, and
    // the join rejects the narrower table as a layout mismatch.
    // Skipped when no source can supply the rate (grouped by age, or an age
    // filter CDC will not adjust over): the column would be blank from top to
    // bottom, and the page already says which measures are not in a result.
    if (spec.measures.includes("ageAdjustedRate") && ageAdjustedBlocker(spec) === null) {
      table = ensureMeasureColumn(table, "ageAdjustedRate", "Age-Adjusted Rate");
      if (needsComputedAdjustment(spec, source)) {
        const filled = await computeAdjustedRates(sub, spec, fetchTable);
        if (filled) {
          table = filled(table);
          computedYears.push(...(sub.filters?.year ?? []));
        }
      }
    }
    parts.push({ databaseId: source.databaseId, table });
  }

  const joined = stitchTables(parts);
  if ("error" in joined) return { ok: false, error: joined.error, status: 502 };
  return {
    ok: true,
    table: { ...joined.table, sourceNotes: notes(joined.provenance, computedYears) },
  };
}

/**
 * What the reader needs to know about a series that came from several files.
 *
 * Which years came from where, because the files are different vintages of the
 * same records and a step at a boundary might be the boundary rather than the
 * data; and which age-adjusted rates were computed here, because those are not
 * CDC figures and should not be cited as though they were.
 */
function notes(
  provenance: { databaseId: string; years: string[] }[],
  computedYears: string[],
): string[] {
  // WONDER labels a provisional year "2026 (provisional and partial)". That
  // belongs on the axis, not inside "2025 (provisional)-2026 (provisional and
  // partial) from ...", which is unreadable; the provisional status is said
  // plainly in the sentence that follows anyway.
  const bare = (y: string) => y.replace(/\s*\(.*\)\s*$/, "");
  const out = provenance
    .filter((p) => p.years.length > 0)
    .map((p) => {
      const db = getDatabase(p.databaseId);
      const years = p.years.map(bare);
      const span = years.length === 1 ? years[0] : `${years[0]}–${years[years.length - 1]}`;
      return `${span} from ${db.label}.`;
    });
  if (computedYears.length > 0) {
    const span =
      computedYears.length === 1
        ? computedYears[0]
        : `${computedYears[0]}–${computedYears[computedYears.length - 1]}`;
    out.push(
      `Age-adjusted rates for ${span} were computed here by direct standardisation to the 2000 US standard population, because the provisional file does not publish them. CDC does not publish these figures.`,
    );
  }
  return out;
}

/** Only worth attempting when it can produce a real answer. */
function needsComputedAdjustment(spec: QuerySpec, source: CompositeSource): boolean {
  const db = getDatabase(source.databaseId);
  if (!spec.measures.includes("ageAdjustedRate")) return false;
  if (db.measures.includes("ageAdjustedRate")) return false; // it publishes its own
  // Standardising a series already split by age would be circular, and five
  // group-by slots is WONDER's hard limit.
  if (spec.groupBy.some((k) => k.startsWith("age"))) return false;
  if (spec.groupBy.length >= 5) return false;
  // Whatever stops CDC publishing the rate for the final years (an age filter,
  // chiefly) stops it being computed for the provisional ones too: the strata
  // would not span the standard population, and the attempt costs a CDC call
  // and fifteen seconds to find that out.
  if (ageAdjustedBlocker(spec) !== null) return false;
  return db.variables.some((v) => v.key === "ageTen");
}

/**
 * Query the same slice again with age added, and return a function that splices
 * the computed rates into the original table.
 */
async function computeAdjustedRates(
  sourceSpec: QuerySpec,
  originalSpec: QuerySpec,
  fetchTable: FetchTable,
): Promise<((t: ResultTable) => ResultTable) | null> {
  const byAge = await fetchTable({
    ...sourceSpec,
    groupBy: [...sourceSpec.groupBy, "ageTen"],
    measures: ["deaths", "population"],
  });
  // A failure here costs the measure, not the query: the rest of the series is
  // still correct and the column simply stays blank for these years.
  if (!byAge.ok) return null;

  const t = byAge.table;
  const dims = t.columns
    .map((c, index) => ({ c, index }))
    .filter((x) => x.c.kind === "dimension");
  const ageCol = dims.find((d) => d.c.variableKey === "ageTen");
  const groupDims = dims.filter((d) => d.c.variableKey !== "ageTen");
  const deathsIdx = t.columns.findIndex((c) => c.measureKey === "deaths");
  const popIdx = t.columns.findIndex((c) => c.measureKey === "population");
  if (!ageCol || deathsIdx < 0 || popIdx < 0) return null;

  // Gather the age strata belonging to each group.
  const strata = new Map<string, AgeStratum[]>();
  for (let i = 0; i < t.rows.length; i++) {
    if (t.rowIsTotal[i]) continue;
    const row = t.rows[i];
    const key = groupDims.map((d) => cellLabel(row[d.index])).join("");
    const deaths = cellNumber(row[deathsIdx]);
    const population = cellNumber(row[popIdx]);
    // A suppressed stratum cannot be standardised over; the coverage check in
    // ageAdjustedRate is what catches the resulting gap.
    if (deaths === null || population === null) continue;
    strata.set(key, [
      ...(strata.get(key) ?? []),
      { ageLabel: cellLabel(row[ageCol.index]), deaths, population },
    ]);
  }

  const adjusted = new Map<string, number>();
  for (const [key, group] of strata) {
    const r = ageAdjustedRate(group, originalSpec.options?.ratePer ?? 100000);
    if (r) adjusted.set(key, r.rate);
  }
  if (adjusted.size === 0) return null;

  // The key must be built the same way from the original table, which has the
  // same grouping minus the age column.
  const keyOf = (row: ResultCell[], columns: ResultTable["columns"]) =>
    columns
      .map((c, i) => ({ c, i }))
      .filter((x) => x.c.kind === "dimension" && x.c.variableKey !== "ageTen")
      .map((x) => cellLabel(row[x.i]))
      .join("");

  return (table: ResultTable) => spliceAdjustedRates(table, adjusted, keyOf);
}
