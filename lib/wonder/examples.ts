// One-click starting points.
//
// The query builder opens on "all deaths by year", which is correct but tells a
// first-time visitor nothing about what the tool can do. These are complete,
// runnable QuerySpecs covering the questions this site actually gets used for,
// so a new user can land on a real result and then edit it rather than assemble
// one from an empty form.
//
// Every code here comes from lib/wonder/data/d158_variables.json.

import type { QuerySpec } from "./types";
import { ICD_PRESETS } from "./databases";
import { getDatabase } from "./db/registry";

export interface ExampleQuery {
  label: string;
  /** Shown under the label so the chip explains itself. */
  hint: string;
  spec: QuerySpec;
}

// Every example shares the same shell; only groupBy and filters differ.
// Not `as const` — QuerySpec's arrays are mutable and the builder edits them.
const BASE: Pick<QuerySpec, "database" | "measures" | "options"> = {
  database: "D158",
  // Age-adjusted rate is requested throughout; WONDER (and measureColumns)
  // drop it automatically for the examples that group by age, where it has no
  // meaning.
  measures: ["deaths", "population", "crudeRate", "ageAdjustedRate"],
  options: { showTotals: true, showZeros: true, showSuppressed: true, ratePer: 100000 },
};

const overdoseCodes = ICD_PRESETS.find((p) => p.label.startsWith("Drug overdose"))?.codes ?? [];

export const EXAMPLE_QUERIES: ExampleQuery[] = [
  {
    label: "Suicide by method",
    hint: "Year × mechanism",
    spec: {
      ...BASE,
      groupBy: ["year", "injuryMechanism"],
      filters: { injuryIntent: ["2"] },
    },
  },
  {
    label: "Suicide rates by age",
    hint: "Ten-year age groups",
    spec: {
      ...BASE,
      groupBy: ["ageTen"],
      filters: { injuryIntent: ["2"] },
    },
  },
  {
    label: "Suicide by sex and race",
    hint: "Counts vs. rates",
    spec: {
      ...BASE,
      groupBy: ["sex", "race6"],
      filters: { injuryIntent: ["2"] },
    },
  },
  {
    label: "Firearm suicide trend",
    hint: "Year × sex, firearm",
    spec: {
      ...BASE,
      groupBy: ["year", "sex"],
      filters: { injuryIntent: ["2"], injuryMechanism: ["GRINJ-006"] },
    },
  },
  {
    label: "Youth suicide, ages 10–24",
    hint: "Year × age group",
    spec: {
      ...BASE,
      groupBy: ["year", "ageFive"],
      filters: { injuryIntent: ["2"], ageFive: ["10-14", "15-19", "20-24"] },
    },
  },
  {
    label: "Drug overdose deaths",
    hint: "ICD-10 codes, by year",
    spec: {
      ...BASE,
      groupBy: ["year"],
      filters: { ucdCause: overdoseCodes },
    },
  },
  {
    label: "Deaths by manner",
    hint: "Suicide, homicide, accident",
    spec: {
      ...BASE,
      groupBy: ["year", "injuryIntent"],
      filters: {},
    },
  },
];

/**
 * The examples that make sense for a given dataset.
 *
 * An example naming a variable the dataset does not have would produce a
 * query WONDER rejects, so those are dropped rather than shown broken; the
 * measures are narrowed to what the dataset publishes (no age-adjusted rate
 * for provisional data).
 */
export function examplesFor(databaseId: string): ExampleQuery[] {
  const db = getDatabase(databaseId);
  const available = new Set(db.variables.map((v) => v.key));
  return EXAMPLE_QUERIES.filter((e) => {
    const used = [...e.spec.groupBy, ...Object.keys(e.spec.filters)];
    return used.every((k) => available.has(k));
  }).map((e) => ({
    ...e,
    spec: {
      ...e.spec,
      database: db.id,
      measures: e.spec.measures.filter((m) => db.measures.includes(m)),
    },
  }));
}
