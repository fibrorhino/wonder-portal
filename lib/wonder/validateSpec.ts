// Turning whatever arrived in a request body into a QuerySpec that is safe to
// build a WONDER request from, or a message saying why not.
//
// This used to live inside app/api/wonder/route.ts, where nothing could test
// it, and it trusted the shape of the body: `null` threw before validation
// began, a missing `measures` threw inside the request builder, and a filter
// sent as a string instead of a list was spread into one code per character.
// Each of those surfaced as a bare HTTP 500, which the page reports as "the
// server is temporarily unavailable". The endpoint is public and specs also
// arrive from shared links and stored history, so the shape is checked here.

import type { MeasureKey, QuerySpec } from "./types";
import { getDatabase, isKnownDatabase, variableByKey } from "./db/registry";

const MEASURE_KEYS: MeasureKey[] = ["deaths", "population", "crudeRate", "ageAdjustedRate"];

/** Rate denominators accepted. The builder only ever sends 100,000. */
const RATE_PER_CHOICES = [1000, 10000, 100000, 1000000];

/** A finder filter (years, ICD codes) is free text; this bounds how much of it. */
const MAX_CODES_PER_FILTER = 2000;
const MAX_CODE_LENGTH = 40;

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Coerce a parsed JSON body into a QuerySpec.
 *
 * Returns the spec with `filters` and `options` always present, or a string
 * describing the first thing wrong with it. Does not decide whether the query
 * makes sense (that is `validateSpec`), only that it has the right shape.
 */
export function normalizeSpec(raw: unknown): QuerySpec | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "Missing query spec.";
  const o = raw as Record<string, unknown>;

  if (typeof o.database !== "string") return "Missing dataset.";
  if (!isStringArray(o.groupBy)) return "Select at least one 'Group results by' variable.";

  // Unknown measures are dropped rather than refused: deaths is always returned
  // regardless, so a stale link naming a measure that no longer exists still
  // produces a usable table.
  const measures = Array.isArray(o.measures)
    ? MEASURE_KEYS.filter((m) => (o.measures as unknown[]).includes(m))
    : [];

  const filters: Record<string, string[]> = {};
  if (o.filters != null) {
    if (typeof o.filters !== "object" || Array.isArray(o.filters)) return "Filters are malformed.";
    for (const [key, codes] of Object.entries(o.filters as Record<string, unknown>)) {
      if (codes == null) continue;
      if (!isStringArray(codes)) return `Filter "${key}" must be a list of values.`;
      if (codes.length > MAX_CODES_PER_FILTER) return `Filter "${key}" has too many values.`;
      if (codes.some((c) => c.length > MAX_CODE_LENGTH)) return `Filter "${key}" has a value that is too long.`;
      filters[key] = codes;
    }
  }

  const rawOptions =
    o.options && typeof o.options === "object" && !Array.isArray(o.options)
      ? (o.options as Record<string, unknown>)
      : {};
  const options: QuerySpec["options"] = {};
  if (typeof rawOptions.showTotals === "boolean") options.showTotals = rawOptions.showTotals;
  if (typeof rawOptions.showZeros === "boolean") options.showZeros = rawOptions.showZeros;
  if (typeof rawOptions.showSuppressed === "boolean") options.showSuppressed = rawOptions.showSuppressed;
  if (rawOptions.ratePer !== undefined) {
    // This number goes into the request and into every rate computed here, so
    // an arbitrary one is refused rather than passed along.
    if (!RATE_PER_CHOICES.includes(rawOptions.ratePer as number)) {
      return `Rates can be per ${RATE_PER_CHOICES.map((n) => n.toLocaleString("en-US")).join(", ")}.`;
    }
    options.ratePer = rawOptions.ratePer as number;
  }

  return { database: o.database, groupBy: o.groupBy, measures, filters, options };
}

/**
 * Whether a well-formed spec describes a query WONDER can run. Returns the
 * reason it cannot, or null.
 */
export function validateSpec(spec: QuerySpec): string | null {
  if (!isKnownDatabase(spec.database)) return `Unknown dataset: ${spec.database}`;
  // Variables are per-database: D176 has no weekday, education or leading-cause
  // variable, and validating against D158's registry would wave those through
  // to a request WONDER then rejects.
  const dbDef = getDatabase(spec.database);
  const VARIABLE_BY_KEY = variableByKey(dbDef);
  if (spec.groupBy.length === 0) return "Select at least one 'Group results by' variable.";
  if (spec.groupBy.length > 5) return "At most 5 group-by variables.";
  if (new Set(spec.groupBy).size !== spec.groupBy.length) {
    return "The same variable is listed twice under 'Group results by'.";
  }
  for (const key of spec.groupBy) {
    const def = VARIABLE_BY_KEY[key];
    if (!def) return `Unknown variable: ${key}`;
    if (!def.canGroup) return `Cannot group by: ${def.label}`;
  }
  for (const m of spec.measures) {
    if (!dbDef.measures.includes(m)) {
      return `${dbDef.label} does not provide the ${m} measure.`;
    }
  }
  const ageGroups = spec.groupBy.filter((k) => k.startsWith("age"));
  if (ageGroups.length > 1) return "Only one age grouping at a time.";
  const raceGroups = spec.groupBy.filter((k) => k.startsWith("race"));
  if (raceGroups.length > 1) return "Only one race grouping at a time.";
  for (const key of Object.keys(spec.filters)) {
    const def = VARIABLE_BY_KEY[key];
    if (!def) return `Unknown filter variable: ${key}`;
    if (!def.canFilter && spec.filters[key].length > 0) return `Cannot filter by: ${def.label}`;
  }
  // Several WONDER sections are a single radio: O_ucd selects WHICH cause
  // framework the query uses (ICD codes | injury intent/mechanism | leading
  // causes), O_age which age variable, O_race which race variable. Two
  // variables sharing a selector but needing different values cannot coexist
  // in one query — and that applies to FILTERS as much as to grouping.
  // Filtering on both Ten-Year and Five-Year age groups, for instance, used to
  // be accepted here and then resolved to whichever selector was written last,
  // so the query silently ran with one of the two age filters ignored.
  const usedKeys = [
    ...spec.groupBy,
    ...Object.entries(spec.filters)
      .filter(([, v]) => v && v.length > 0)
      .map(([k]) => k),
  ];
  const bySection = new Map<string, Map<string, string[]>>();
  for (const key of usedKeys) {
    const control = VARIABLE_BY_KEY[key]?.control;
    if (!control) continue;
    let byValue = bySection.get(control.param);
    if (!byValue) {
      byValue = new Map();
      bySection.set(control.param, byValue);
    }
    byValue.set(control.value, [
      ...(byValue.get(control.value) ?? []),
      VARIABLE_BY_KEY[key]?.label ?? key,
    ]);
  }

  if ((bySection.get("O_ucd")?.size ?? 0) > 1) {
    return (
      "Only one cause-of-death framework can be used per query: choose ICD-10 codes, " +
      "injury intent/mechanism, OR leading causes — not a mix. Run separate queries instead."
    );
  }
  const SECTION_LABEL: Record<string, string> = {
    O_age: "age variable",
    O_race: "race variable",
  };
  for (const [param, byValue] of bySection) {
    if (param === "O_ucd" || byValue.size <= 1) continue;
    // A variable used for BOTH grouping and filtering is collected twice.
    const names = [...new Set([...byValue.values()].flat())].join(", ");
    return `Only one ${SECTION_LABEL[param] ?? param} can be used per query, whether grouping or filtering. Remove one of: ${names}.`;
  }
  return null;
}
