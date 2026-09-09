// The datasets the app can query.
//
// D158's definition is ADAPTED from lib/wonder/databases.ts rather than copied
// into this folder. That module is the result of months of verification against
// the live API, and re-typing it here would risk a silent transcription error
// in exactly the values that are hardest to notice being wrong. It stays the
// source of truth; this file only describes it.

import * as d158 from "../databases";
import { D176 } from "./d176";
import { D76 } from "./d76";
import { COMBINED } from "./combined";
import type { DatabaseDef } from "./types";

export const D158: DatabaseDef = {
  id: d158.DATABASE_ID,
  label: d158.DATABASE_LABEL,
  shortLabel: "Final mortality (2018–2024)",
  blurb:
    "The final, fully coded file. Complete and not subject to revision, but it stops at 2024.",
  // The literal string WONDER expects — not the display label above.
  datasetLabel: "Underlying Cause of Death, by Single-Race Categories",
  years: d158.AVAILABLE_YEARS,
  provisional: false,
  variables: d158.VARIABLES,
  measures: ["deaths", "population", "crudeRate", "ageAdjustedRate"],
  // Residence-only finder set. Occurrence-geography variables do not exist in
  // D158 and including them produces a generic "Processing Error".
  finderVars: ["V1", "V10", "V2", "V27", "V9"],
  valueVars: [
    "V11", "V12", "V17", "V18", "V19", "V20", "V21", "V22", "V23", "V24",
    "V28", "V4", "V42", "V43", "V44", "V45", "V5", "V51", "V52", "V7",
  ],
  selectors: {
    age: "D158.V5",
    race: "D158.V42",
    location: "D158.V9",
    urban: "D158.V19",
    ucd: "D158.V2",
  },
  grammar: "expanded",
  ageAdjustVars: ["V10", "V17", "V1_S", "V42", "V7"],
  extraParams: {},
  supportsDisplayToggles: true,
  icdPresets: d158.ICD_PRESETS,
  // Verified 2026-09-09: returns HTTP 200 and its <title> is "Underlying Cause
  // of Death, 2018-2024, Single Race Request". WONDER's API does not return a
  // suggested citation — its web UI adds one to the results page — so
  // lib/methods.ts reconstructs it from these two fields.
  wonderPage: "https://wonder.cdc.gov/ucd-icd10-expanded.html",
  citationFile: "Multiple Cause of Death Files, 2018-2024",
};

// Newest-first: the final file is the default, provisional adds recency,
// and the classic file adds twenty years of history.
export const DATABASES: DatabaseDef[] = [D158, D176, D76, COMBINED];

export const DEFAULT_DATABASE_ID = D158.id;

const BY_ID: Record<string, DatabaseDef> = Object.fromEntries(
  DATABASES.map((d) => [d.id, d]),
);

/**
 * Look up a dataset. Falls back to the default rather than throwing: the id can
 * arrive from a shared link or stored history, and an unknown one should land
 * the user on the working dataset rather than on an error page.
 */
export function getDatabase(id: string | undefined): DatabaseDef {
  return (id && BY_ID[id]) || BY_ID[DEFAULT_DATABASE_ID];
}

export function isKnownDatabase(id: string | undefined): boolean {
  return Boolean(id && BY_ID[id]);
}

export type { DatabaseDef } from "./types";
export { variableByKey } from "./types";
