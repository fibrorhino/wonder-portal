// Underlying Cause of Death, 1999-2020 (WONDER database D76).
//
// The reason to have it: twenty-two years of history. D158 starts at 2018,
// which is too short a run for a trend, let alone a joinpoint fit. Together the
// two cover 1999 to the present, though not in one query — see the note on
// race below for why they should not simply be concatenated.
//
// This is the CLASSIC parameter grammar, and it is genuinely a different API
// from D158's. It has no dataset_code, no dataset_label, no saved_id, no
// O_dates and no O_race, and sending those is not worth the risk when its own
// template shows exactly what it wants. Verified against the live endpoint: the
// published template returns data unchanged, and adding M_4 with O_aar=aar_std
// returns age-adjusted rates.
//
// RACE IS NOT COMPARABLE WITH THE NEWER FILES. D76 uses the four BRIDGED race
// categories (White; Black or African American; American Indian or Alaska
// Native; Asian or Pacific Islander), where deaths recorded under multiple
// races are bridged back to one. D158 uses single-race categories and splits
// Asian from Native Hawaiian or Other Pacific Islander. A "Asian or Pacific
// Islander" figure here and an "Asian" figure there are different
// denominators and different numerators, so the app exposes this variable under
// its own key and the cross-dataset comparison guard keeps the two apart.

import rawMeta from "../data/d158_variables.json";
import baseParams from "../data/d76_base.json";
import type { VariableDef, VariableValue } from "../databases";
import { ICD_PRESETS } from "../databases";
import type { DatabaseDef } from "./types";

type RawMeta = Record<string, { label: string; values: { code: string; label: string }[] }>;
const META = rawMeta as RawMeta;

const DB = "D76";

/** Shared WONDER code sets: sex, age, Hispanic origin, injury intent/mechanism. */
function valuesFor(d158VarCode: string): VariableValue[] {
  return META[d158VarCode]?.values ?? [];
}

const YEARS = Array.from({ length: 2020 - 1999 + 1 }, (_, i) => String(1999 + i));

/**
 * Bridged race, D76.V8. Verified live by grouping on it: the four labels come
 * back exactly as below, and all four codes appear in the response's echo of
 * the request.
 */
const BRIDGED_RACE: VariableValue[] = [
  { code: "1002-5", label: "American Indian or Alaska Native" },
  { code: "A-PI", label: "Asian or Pacific Islander" },
  { code: "2054-5", label: "Black or African American" },
  { code: "2106-3", label: "White" },
];

const VARIABLES: VariableDef[] = [
  // ---- Time ----
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
    note: "Groups by year + month.",
    values: [],
  },
  {
    key: "weekday",
    label: "Weekday of Death",
    varCode: `${DB}.V24`,
    filterMode: "value",
    groupToken: `${DB}.V24`,
    canGroup: true,
    canFilter: true,
    group: "Time",
    values: valuesFor("D158.V24"),
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
    // Deliberately NOT keyed "race6": the categories are bridged, not single
    // race, so a spec written for one file must not silently run on the other.
    key: "raceBridged",
    label: "Race (Bridged, 4 groups)",
    varCode: `${DB}.V8`,
    filterMode: "value",
    groupToken: `${DB}.V8`,
    canGroup: true,
    canFilter: true,
    group: "Demographics",
    note: "Bridged race: deaths recorded under multiple races are assigned to one. Not comparable with the single-race categories in the 2018-onward files.",
    values: BRIDGED_RACE,
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
    key: "autopsy",
    label: "Autopsy",
    varCode: `${DB}.V20`,
    filterMode: "value",
    groupToken: `${DB}.V20`,
    canGroup: true,
    canFilter: true,
    group: "Cause of death",
    values: valuesFor("D158.V20"),
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

export const D76: DatabaseDef = {
  id: DB,
  label: "Underlying Cause of Death, 1999-2020",
  shortLabel: "Historical mortality (1999–2020)",
  blurb:
    "Twenty-two years of final data — long enough for a real trend. Uses bridged race categories, which are not comparable with the single-race ones in the newer files.",
  // The classic grammar sends no dataset_label; kept for display only.
  datasetLabel: "Underlying Cause of Death, 1999-2020",
  years: YEARS,
  provisional: false,
  variables: VARIABLES,
  measures: ["deaths", "population", "crudeRate", "ageAdjustedRate"],
  finderVars: ["V1", "V2", "V9", "V10", "V27"],
  valueVars: [
    "V11", "V12", "V17", "V19", "V2", "V20", "V21", "V22", "V23", "V24",
    "V25", "V4", "V5", "V51", "V52", "V7", "V8", "V9",
  ],
  selectors: {
    age: `${DB}.V5`,
    // No race selector exists on this grammar; race is a plain value variable.
    location: `${DB}.V9`,
    urban: `${DB}.V19`,
    ucd: `${DB}.V2`,
  },
  grammar: "classic",
  // Bridged race V8 stands where the newer files use single race V42.
  ageAdjustVars: ["V10", "V17", "V1_S", "V8", "V7"],
  extraParams: {},
  baseParams: baseParams as Record<string, string[]>,
  // Absent from this grammar's template.
  supportsDisplayToggles: false,
  icdPresets: ICD_PRESETS,
  // Verified 2026-09-09: HTTP 200, title matches this database.
  wonderPage: "https://wonder.cdc.gov/ucd-icd10.html",
  citationFile: "Multiple Cause of Death Files, 1999-2020",
};
