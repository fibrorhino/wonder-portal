// Provisional Mortality Statistics (WONDER database D176).
//
// The reason to have it: it runs from 2018 through last month, so it carries
// the two most recent years that the final file (D158) does not. The price is
// that the newest data is incomplete and will be revised.
//
// Everything here was established against the live endpoint, because none of it
// is documented:
//   - The published D176 request template from 2022 is now rejected with
//     "Missing parameter O_PR, needed for stored procedure." Adding O_PR=false
//     makes it work. That parameter does not exist in D158 at all.
//   - There is no M_4: D176 returns deaths, population and crude rate only.
//     Age-adjusted rates are not available for provisional data.
//   - Its variable set is not D158's. There is no weekday (V24), no education
//     (V45) and no 15-leading-causes (V28). It adds multiple-cause-of-death and
//     occurrence-geography variables that this app does not yet expose.
//   - A stale dataset_vintage was accepted, so it is sent as-is rather than
//     being discovered per request.
//
// The demographic value codes (sex, age, race, Hispanic origin, injury intent
// and mechanism) are WONDER-wide code sets and are reused from the D158
// metadata; that reuse is verified by a live query in the notes for this file.

import rawMeta from "../data/d158_variables.json";
import baseParams from "../data/d176_base.json";
import type { VariableDef, VariableValue } from "../databases";
import { ICD_PRESETS } from "../databases";
import type { DatabaseDef } from "./types";

type RawMeta = Record<string, { label: string; values: { code: string; label: string }[] }>;
const META = rawMeta as RawMeta;

const DB = "D176";

/**
 * Value lists come from the D158 metadata because these are shared WONDER code
 * sets — "M"/"F" for sex, "2106-3" for White, "2" for suicide — not per-database
 * inventions. Verified live: a D176 query grouped by sex and race returns the
 * same labels for the same codes.
 */
function valuesFor(d158VarCode: string): VariableValue[] {
  return META[d158VarCode]?.values ?? [];
}

/** 2018 through the current year; the last two are provisional. */
const YEARS = (() => {
  const thisYear = new Date().getUTCFullYear();
  const out: string[] = [];
  for (let y = 2018; y <= thisYear; y++) out.push(String(y));
  return out;
})();

const VARIABLES: VariableDef[] = [
  {
    key: "year",
    label: "Year",
    varCode: `${DB}.V1`,
    filterMode: "finder",
    groupToken: `${DB}.V1-level1`,
    canGroup: true,
    canFilter: true,
    group: "Time",
    values: YEARS.map((y) => ({ code: y, label: y })),
  },
  {
    key: "month",
    label: "Month",
    varCode: `${DB}.V1`,
    filterMode: "finder",
    groupToken: `${DB}.V1-level2`,
    canGroup: true,
    canFilter: false,
    group: "Time",
    note: "Groups by year + month. The most recent months are the least complete.",
    values: [],
  },
  // ---- Demographics ----
  {
    key: "sex",
    label: "Sex",
    varCode: `${DB}.V7`,
    filterMode: "value",
    groupToken: `${DB}.V7`,
    canGroup: true,
    canFilter: true,
    group: "Demographics",
    values: valuesFor("D158.V7"),
  },
  {
    key: "ageTen",
    label: "Age (Ten-Year Groups)",
    varCode: `${DB}.V5`,
    filterMode: "value",
    groupToken: `${DB}.V5`,
    canGroup: true,
    canFilter: true,
    control: { param: "O_age", value: `${DB}.V5` },
    group: "Demographics",
    values: valuesFor("D158.V5"),
  },
  {
    key: "ageFive",
    label: "Age (Five-Year Groups)",
    varCode: `${DB}.V51`,
    filterMode: "value",
    groupToken: `${DB}.V51`,
    canGroup: true,
    canFilter: true,
    control: { param: "O_age", value: `${DB}.V51` },
    group: "Demographics",
    values: valuesFor("D158.V51"),
  },
  {
    key: "ageSingle",
    label: "Age (Single-Year)",
    varCode: `${DB}.V52`,
    filterMode: "value",
    groupToken: `${DB}.V52`,
    canGroup: true,
    canFilter: true,
    control: { param: "O_age", value: `${DB}.V52` },
    group: "Demographics",
    values: valuesFor("D158.V52"),
  },
  {
    key: "hispanicOrigin",
    label: "Hispanic Origin",
    varCode: `${DB}.V17`,
    filterMode: "value",
    groupToken: `${DB}.V17`,
    canGroup: true,
    canFilter: true,
    group: "Demographics",
    values: valuesFor("D158.V17"),
  },
  {
    key: "race6",
    label: "Race (Single Race, 6 groups)",
    varCode: `${DB}.V42`,
    filterMode: "value",
    groupToken: `${DB}.V42`,
    canGroup: true,
    canFilter: true,
    control: { param: "O_race", value: `${DB}.V42` },
    group: "Demographics",
    values: valuesFor("D158.V42"),
  },
  {
    key: "race15",
    label: "Race (Single Race, 15 groups)",
    varCode: `${DB}.V43`,
    filterMode: "value",
    groupToken: `${DB}.V43`,
    canGroup: true,
    canFilter: true,
    control: { param: "O_race", value: `${DB}.V43` },
    group: "Demographics",
    values: valuesFor("D158.V43"),
  },
  // ---- Cause of death ----
  {
    key: "injuryIntent",
    label: "Injury Intent",
    varCode: `${DB}.V22`,
    filterMode: "value",
    groupToken: `${DB}.V22`,
    canGroup: true,
    canFilter: true,
    control: { param: "O_ucd", value: `${DB}.V22` },
    group: "Cause of death",
    note: "Suicide = intent code 2. Applies to injury deaths.",
    values: valuesFor("D158.V22"),
  },
  {
    key: "injuryMechanism",
    label: "Injury Mechanism & All Other Leading Causes",
    varCode: `${DB}.V23`,
    filterMode: "value",
    groupToken: `${DB}.V23`,
    canGroup: true,
    canFilter: true,
    control: { param: "O_ucd", value: `${DB}.V22` },
    group: "Cause of death",
    note: "Cause/method breakdown: Firearm, Fall, Poisoning, Suffocation, Motor Vehicle, plus non-injury leading causes.",
    values: valuesFor("D158.V23"),
  },
  {
    key: "placeOfDeath",
    label: "Place of Death",
    varCode: `${DB}.V21`,
    filterMode: "value",
    groupToken: `${DB}.V21`,
    canGroup: true,
    canFilter: true,
    group: "Cause of death",
    values: valuesFor("D158.V21"),
  },
  {
    key: "ucdCause",
    label: "Underlying Cause (ICD-10 codes)",
    varCode: `${DB}.V2`,
    filterMode: "finder",
    groupToken: `${DB}.V2-level1`,
    canGroup: true,
    canFilter: true,
    control: { param: "O_ucd", value: `${DB}.V2` },
    group: "Cause of death",
    note: "Filter by ICD-10 codes/ranges, e.g. X60-X84. Grouping is by ICD chapter.",
    values: [],
  },
];

export const D176: DatabaseDef = {
  id: DB,
  label: "Provisional Mortality Statistics, 2018 through Last Month",
  shortLabel: "Provisional mortality (2018–present)",
  blurb:
    "Includes the two most recent years, which the final file does not. The newest periods are incomplete and will be revised upward.",
  datasetLabel: "Provisional Mortality Statistics, 2018 through Last Month",
  years: YEARS,
  provisional: true,
  variables: VARIABLES,
  // No M_4: age-adjusted rates are not published for provisional data.
  measures: ["deaths", "population", "crudeRate"],
  finderVars: ["V1", "V2", "V9", "V10", "V27"],
  valueVars: [
    "V11", "V12", "V17", "V19", "V20", "V21", "V22", "V23",
    "V25", "V4", "V42", "V43", "V44", "V5", "V51", "V52", "V7",
  ],
  selectors: {
    age: `${DB}.V5`,
    race: `${DB}.V42`,
    location: `${DB}.V9`,
    urban: `${DB}.V19`,
    ucd: `${DB}.V2`,
  },
  extraParams: {
    // Required, and absent from D158 entirely — without it the request is
    // rejected with "Missing parameter O_PR, needed for stored procedure."
    O_PR: "false",
    // Report by calendar period rather than MMWR week.
    O_MMWR: "false",
    // Multiple-cause and occurrence-geography selectors this app does not
    // expose, but which WONDER expects to be present.
    O_mcd: `${DB}.V13`,
    O_death_location: `${DB}.V79`,
  },
  // Captured from a request verified against the live endpoint. Without the
  // multiple-cause and occurrence-geography scaffolding it carries, D176
  // answers HTTP 500.
  baseParams: baseParams as Record<string, string[]>,
  // D176's own request template omits these; they are not sent.
  supportsDisplayToggles: false,
  icdPresets: ICD_PRESETS,
};
