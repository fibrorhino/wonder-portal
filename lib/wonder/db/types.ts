// What the app needs to know about one CDC WONDER database.
//
// Every WONDER database is its own API: the variable numbering differs, the
// required parameters differ, and the same request that works for one is
// rejected by another. D176 refused the D158-shaped request outright ("Missing
// parameter O_PR"), and there is no documentation for any of it — each field
// here was established by probing the live endpoint.
//
// So a database is not a string passed to a shared query builder; it is a
// definition the builder is driven by.

import type { MeasureKey } from "../types";
import type { VariableDef } from "../databases";

export interface DatabaseDef {
  /** WONDER's id, and the last path segment of the request URL, e.g. "D158". */
  id: string;
  /** Human name shown in the dataset picker. */
  label: string;
  /** Short label for tight spaces. */
  shortLabel: string;
  /** One line on what this dataset is for, shown under the picker. */
  blurb: string;
  /** The literal value WONDER expects for the `dataset_label` parameter. */
  datasetLabel: string;
  /** Years the dataset covers, newest last. */
  years: string[];
  /**
   * True when the most recent periods are provisional: incomplete, revised
   * later, and — for the current year — only partially elapsed. Drives the
   * partial-period guards in the analysis.
   */
  provisional: boolean;
  /** Variables this database exposes, in query-builder order. */
  variables: VariableDef[];
  /** Measures it can return. Provisional data has no age-adjusted rate. */
  measures: MeasureKey[];
  /** Variables filtered through the F_ finder grammar (short codes, e.g. "V1"). */
  finderVars: string[];
  /** Variables needing a `V_<db>.<var>` = *All* default (short codes). */
  valueVars: string[];
  /**
   * The O_ selector defaults, as short variable codes. WONDER resolves several
   * variable families through a radio selector; without the right default the
   * query silently returns nothing.
   */
  selectors: { age: string; race: string; location: string; urban: string; ucd: string };
  /**
   * Extra name/value parameters this database requires verbatim. D176 needs
   * O_PR, and rejects the request without it.
   */
  extraParams: Record<string, string>;
  /**
   * A complete, verified request captured from the live API, used as the
   * starting point before group-by, measures and filters are applied over the
   * top. D158's base is assembled from the fields above; D176 needs roughly
   * fifty further scaffolding parameters (multiple-cause and occurrence-
   * geography variables it does not expose) and returns HTTP 500 without them,
   * so its template is stored rather than reconstructed.
   */
  baseParams?: Record<string, string[]>;
  /** Whether O_show_zeros / O_show_suppressed are accepted. */
  supportsDisplayToggles: boolean;
  /** Cause-of-death ICD code presets offered in the builder. */
  icdPresets: { label: string; codes: string[] }[];
}

export function variableByKey(db: DatabaseDef): Record<string, VariableDef> {
  return Object.fromEntries(db.variables.map((v) => [v.key, v]));
}
