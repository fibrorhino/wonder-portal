// Registry describing the CDC WONDER "Underlying Cause of Death, 2018-2024,
// Single Race" database (API id D158) in terms the app understands. Every fact
// here (variable codes, value codes, filter mechanism) was verified against the
// live WONDER API. See lib/wonder/data/d158_variables.json for the raw metadata.

import rawMeta from "./data/d158_variables.json";

type RawMeta = Record<string, { label: string; values: { code: string; label: string }[] }>;
const META = rawMeta as RawMeta;

export const DATABASE_ID = "D158";
export const DATABASE_LABEL = "Underlying Cause of Death, 2018-2024, Single Race";
export const AVAILABLE_YEARS = ["2018", "2019", "2020", "2021", "2022", "2023", "2024"];

// How a variable is filtered in the WONDER request grammar.
//  - "value":  filtered via V_<var> list values (categorical, enumerated codes)
//  - "finder": filtered via F_<var> finder codes (large/hierarchical code sets:
//              dates, ICD codes, geography)
export type FilterMode = "value" | "finder";

export interface VariableValue {
  code: string;
  label: string;
}

export interface VariableDef {
  key: string; // friendly key used in QuerySpec
  label: string; // human label
  varCode: string; // e.g. "D158.V7"
  filterMode: FilterMode;
  groupToken: string; // value used in B_n when grouping (e.g. "D158.V7" or "D158.V1-level1")
  canGroup: boolean;
  canFilter: boolean;
  // When selecting this variable's grouping/age/race, WONDER needs a matching
  // O_ selector set (e.g. O_age=D158.V51 for five-year age groups).
  control?: { param: string; value: string };
  group: string; // UI grouping heading
  note?: string;
  // values populated from metadata (empty for finder vars whose codes are open-ended)
  values: VariableValue[];
}

function valuesFor(varCode: string): VariableValue[] {
  return META[varCode]?.values ?? [];
}

// Ordered registry. Order roughly reflects how a user thinks about a query.
export const VARIABLES: VariableDef[] = [
  // ---- Time ----
  {
    key: "year",
    label: "Year",
    varCode: "D158.V1",
    filterMode: "finder",
    groupToken: "D158.V1-level1",
    canGroup: true,
    canFilter: true,
    group: "Time",
    values: AVAILABLE_YEARS.map((y) => ({ code: y, label: y })),
  },
  {
    key: "month",
    label: "Month",
    varCode: "D158.V1",
    filterMode: "finder",
    groupToken: "D158.V1-level2",
    canGroup: true,
    canFilter: false,
    group: "Time",
    note: "Groups by year + month.",
    values: [],
  },
  {
    key: "weekday",
    label: "Weekday of Death",
    varCode: "D158.V24",
    filterMode: "value",
    groupToken: "D158.V24",
    canGroup: true,
    canFilter: true,
    group: "Time",
    values: valuesFor("D158.V24"),
  },
  // ---- Demographics ----
  {
    key: "sex",
    label: "Sex",
    varCode: "D158.V7",
    filterMode: "value",
    groupToken: "D158.V7",
    canGroup: true,
    canFilter: true,
    group: "Demographics",
    values: valuesFor("D158.V7"),
  },
  {
    key: "ageTen",
    label: "Age (Ten-Year Groups)",
    varCode: "D158.V5",
    filterMode: "value",
    groupToken: "D158.V5",
    canGroup: true,
    canFilter: true,
    control: { param: "O_age", value: "D158.V5" },
    group: "Demographics",
    values: valuesFor("D158.V5"),
  },
  {
    key: "ageFive",
    label: "Age (Five-Year Groups)",
    varCode: "D158.V51",
    filterMode: "value",
    groupToken: "D158.V51",
    canGroup: true,
    canFilter: true,
    control: { param: "O_age", value: "D158.V51" },
    group: "Demographics",
    values: valuesFor("D158.V51"),
  },
  {
    key: "ageSingle",
    label: "Age (Single-Year)",
    varCode: "D158.V52",
    filterMode: "value",
    groupToken: "D158.V52",
    canGroup: true,
    canFilter: true,
    control: { param: "O_age", value: "D158.V52" },
    group: "Demographics",
    values: valuesFor("D158.V52"),
  },
  {
    key: "hispanicOrigin",
    label: "Hispanic Origin",
    varCode: "D158.V17",
    filterMode: "value",
    groupToken: "D158.V17",
    canGroup: true,
    canFilter: true,
    group: "Demographics",
    values: valuesFor("D158.V17"),
  },
  {
    key: "race6",
    label: "Race (Single Race, 6 groups)",
    varCode: "D158.V42",
    filterMode: "value",
    groupToken: "D158.V42",
    canGroup: true,
    canFilter: true,
    control: { param: "O_race", value: "D158.V42" },
    group: "Demographics",
    values: valuesFor("D158.V42"),
  },
  {
    key: "race15",
    label: "Race (Single Race, 15 groups)",
    varCode: "D158.V43",
    filterMode: "value",
    groupToken: "D158.V43",
    canGroup: true,
    canFilter: true,
    control: { param: "O_race", value: "D158.V43" },
    group: "Demographics",
    values: valuesFor("D158.V43"),
  },
  {
    key: "race31",
    label: "Race (Single/Multi Race, 31 groups)",
    varCode: "D158.V44",
    filterMode: "value",
    groupToken: "D158.V44",
    canGroup: true,
    canFilter: true,
    control: { param: "O_race", value: "D158.V44" },
    group: "Demographics",
    note: "Most detailed race categorization.",
    values: valuesFor("D158.V44"),
  },
  {
    key: "education",
    label: "Education",
    varCode: "D158.V45",
    filterMode: "value",
    groupToken: "D158.V45",
    canGroup: true,
    canFilter: true,
    group: "Demographics",
    values: valuesFor("D158.V45"),
  },
  // NOTE: Urbanization (V18/V19) is classified by WONDER as a LOCATION variable
  // and is blocked over the API (national-data-only policy), so it is not exposed.
  // ---- Cause of death ----
  // NOTE: WONDER's cause-of-death section is a radio choice — O_ucd selects
  // WHICH cause framework is active (ICD codes, intent/mechanism, leading
  // causes...). A variable's intent/mechanism filter is silently ignored unless
  // O_ucd points at its framework, so these carry an O_ucd control and the API
  // route rejects mixing frameworks in one query. Verified live 2026-07.
  {
    key: "injuryIntent",
    label: "Injury Intent",
    varCode: "D158.V22",
    filterMode: "value",
    groupToken: "D158.V22",
    canGroup: true,
    canFilter: true,
    control: { param: "O_ucd", value: "D158.V22" },
    group: "Cause of death",
    note: "Suicide = intent code 2. Applies to injury deaths.",
    values: valuesFor("D158.V22"),
  },
  {
    key: "injuryMechanism",
    label: "Injury Mechanism & All Other Leading Causes",
    varCode: "D158.V23",
    filterMode: "value",
    groupToken: "D158.V23",
    canGroup: true,
    canFilter: true,
    control: { param: "O_ucd", value: "D158.V22" },
    group: "Cause of death",
    note: "Cause/method breakdown: Firearm, Fall, Poisoning, Suffocation, Motor Vehicle, plus non-injury leading causes.",
    values: valuesFor("D158.V23"),
  },
  {
    key: "leadingCauses",
    label: "15 Leading Causes of Death",
    varCode: "D158.V28",
    filterMode: "value",
    groupToken: "D158.V28",
    canGroup: true,
    canFilter: true,
    control: { param: "O_ucd", value: "D158.V28" },
    group: "Cause of death",
    values: valuesFor("D158.V28"),
  },
  {
    key: "placeOfDeath",
    label: "Place of Death",
    varCode: "D158.V21",
    filterMode: "value",
    groupToken: "D158.V21",
    canGroup: true,
    canFilter: true,
    group: "Cause of death",
    values: valuesFor("D158.V21"),
  },
  {
    key: "autopsy",
    label: "Autopsy",
    varCode: "D158.V20",
    filterMode: "value",
    groupToken: "D158.V20",
    canGroup: true,
    canFilter: true,
    group: "Cause of death",
    values: valuesFor("D158.V20"),
  },
  // NOTE: Drug/Alcohol-Induced Causes (V25) and the ICD-10 113 Cause List (V4)
  // are hierarchical cause frameworks with additional by-variable ordering rules
  // that need more work to support cleanly, so they are not yet exposed.
  // ICD-10 underlying cause: open-ended finder. Filtered by free ICD code tokens.
  {
    key: "ucdCause",
    label: "Underlying Cause (ICD-10 codes)",
    varCode: "D158.V2",
    filterMode: "finder",
    groupToken: "D158.V2-level1",
    canGroup: true,
    canFilter: true,
    control: { param: "O_ucd", value: "D158.V2" },
    group: "Cause of death",
    note: "Filter by ICD-10 codes/ranges, e.g. X60-X84. Grouping is by ICD chapter.",
    values: [],
  },
];

export const VARIABLE_BY_KEY: Record<string, VariableDef> = Object.fromEntries(
  VARIABLES.map((v) => [v.key, v]),
);

// Measures -> WONDER measure codes. Deaths/Population/Crude are always requested
// (WONDER requires M1-M3). Age-adjusted adds M4 and flips O_aar to aar_std.
export const MEASURE_CODES: Record<string, string> = {
  deaths: "D158.M1",
  population: "D158.M2",
  crudeRate: "D158.M3",
  ageAdjustedRate: "D158.M4",
};

// Convenience cause-of-death presets for the picker. For suicide we prefer the
// injury-intent framework (robust) but also expose the ICD-10 code list.
export interface CausePreset {
  label: string;
  // Either an ICD-10 finder filter or an intent/mechanism value filter.
  apply: Partial<QuerySpecFilters>;
}
type QuerySpecFilters = Record<string, string[]>;

export const CAUSE_PRESETS: CausePreset[] = [
  { label: "All causes", apply: {} },
  { label: "Suicide (intent)", apply: { injuryIntent: ["2"] } },
  { label: "Homicide (intent)", apply: { injuryIntent: ["3"] } },
  { label: "Unintentional injury", apply: { injuryIntent: ["1"] } },
  {
    label: "Suicide (ICD-10 X60–X84, U03, Y87.0)",
    apply: {
      ucdCause: [
        ...Array.from({ length: 25 }, (_, i) => `X${60 + i}`), // X60..X84
        "U03",
        "Y87.0",
      ],
    },
  },
  { label: "Drug overdose (X40–X44, X60–X64, X85, Y10–Y14)", apply: { ucdCause: [
    "X40", "X41", "X42", "X43", "X44", "X60", "X61", "X62", "X63", "X64", "X85",
    "Y10", "Y11", "Y12", "Y13", "Y14",
  ] } },
];

export function variableLabel(key: string): string {
  return VARIABLE_BY_KEY[key]?.label ?? key;
}
