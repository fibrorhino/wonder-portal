// A single 1999-to-present series, stitched from the three real databases.
//
// No one WONDER database spans the period: D76 stops at 2020, D158 starts at
// 2018, and only D176 reaches the current year. A trend over a quarter century
// therefore takes two or three queries and a join, which is what this describes.
//
// It is a COMPOSITE, not a database. It has no endpoint of its own; the API
// route translates a query against it into one query per source and
// concatenates the results.
//
// Two things are given up to get the span:
//
// RACE. The older file uses bridged race, the newer ones single race, and they
// are not the same categories — see the note in d76.ts. Measured on the
// 2018-2020 overlap, where the same 141,834 suicides are coded both ways,
// simply collapsing the newer categories understates American Indian or Alaska
// Native by 13.3% and Asian or Pacific Islander by 9.5%. So race is not offered
// here at all rather than offered wrong. Hispanic origin is consistent across
// all three and is available.
//
// AGE-ADJUSTED RATES past 2024. D176 does not publish them. They are computed
// instead, by age group against the 2000 US standard population — see
// lib/stats/ageAdjust.ts.

import type { VariableDef } from "../databases";
import { ICD_PRESETS, VARIABLES as D158_VARIABLES } from "../databases";
import type { DatabaseDef } from "./types";

export const COMBINED_ID = "COMBINED";

export interface CompositeSource {
  databaseId: string;
  /** First year this source supplies, inclusive. */
  from: number;
  /** Last year, inclusive; null means "to the end of what it has". */
  to: number | null;
}

/**
 * Which file supplies which years.
 *
 * The overlap is real — D76 and D158 both cover 2018-2020 and return byte
 * identical deaths, population and age-adjusted rates for them — so the cut
 * points are a choice rather than a constraint. The newer, final file wins for
 * the years it has, since later vintages carry later corrections. Provisional
 * data is used only where nothing final exists.
 */
export const COMBINED_SOURCES: CompositeSource[] = [
  { databaseId: "D76", from: 1999, to: 2017 },
  { databaseId: "D158", from: 2018, to: 2024 },
  { databaseId: "D176", from: 2025, to: null },
];

/** Variables present in all three files. Anything else cannot span the period. */
const COMMON_KEYS = [
  "year",
  "month",
  "sex",
  "ageTen",
  "ageFive",
  "ageSingle",
  "hispanicOrigin",
  "injuryIntent",
  "injuryMechanism",
  "placeOfDeath",
  "ucdCause",
];

// Taken from the D158 registry so labels and value codes match what the newer
// files return; each source translates them to its own variable numbering when
// it builds its own request.
//
// Imported from lib/wonder/databases rather than from ./registry: the registry
// imports THIS module to list the composite, and going back the other way makes
// a cycle in which D158 is still undefined when this file initialises.
const VARIABLES: VariableDef[] = COMMON_KEYS.map((k) =>
  D158_VARIABLES.find((v) => v.key === k),
).filter((v): v is VariableDef => Boolean(v));

const thisYear = new Date().getUTCFullYear();
const YEARS = Array.from({ length: thisYear - 1999 + 1 }, (_, i) => String(1999 + i));

export const COMBINED: DatabaseDef = {
  id: COMBINED_ID,
  label: `Combined series, 1999–${thisYear}`,
  shortLabel: `Combined 1999–${thisYear} (all three files)`,
  blurb:
    "One series across all three files, for long trends. Only the variables common to all of them are available, and race is not among them.",
  datasetLabel: "Combined",
  years: YEARS,
  // The tail comes from the provisional file, so every partial-period guard applies.
  provisional: true,
  variables: VARIABLES,
  measures: ["deaths", "population", "crudeRate", "ageAdjustedRate"],
  // Never used: a composite builds no request of its own.
  finderVars: [],
  valueVars: [],
  selectors: {},
  grammar: "expanded",
  ageAdjustVars: [],
  extraParams: {},
  supportsDisplayToggles: true,
  icdPresets: ICD_PRESETS,
  composite: COMBINED_SOURCES,
};

/** Years this source should be asked for, given the years the user wants. */
export function yearsForSource(
  source: CompositeSource,
  requested: string[] | undefined,
  allYears: string[],
): string[] {
  const wanted = requested?.length ? requested : allYears;
  return wanted.filter((y) => {
    const n = parseInt(y, 10);
    if (!Number.isFinite(n)) return false;
    return n >= source.from && (source.to === null || n <= source.to);
  });
}
