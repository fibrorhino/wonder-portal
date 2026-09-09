// Joining the result tables from several WONDER databases into one.
//
// The sources are queried separately — they are different APIs — and each
// returns its own ResultTable. Because the composite asks every source for the
// same grouping and the same measures, the tables arrive with the same column
// shape, and joining them is concatenation plus a sort.
//
// What it must not do is paper over a difference. If a source came back with a
// different column layout, concatenating would silently put one variable's
// values in another's column, so that is refused rather than reconciled.

import type { MeasureKey, ResultCell, ResultTable } from "./types";
import { cellLabel, cellNumber } from "../tableUtils";

export interface StitchSource {
  databaseId: string;
  table: ResultTable;
}

export interface StitchResult {
  table: ResultTable;
  /** Which database each year came from, for the caveats. */
  provenance: { databaseId: string; years: string[] }[];
}

/** Column identity, so mismatched shapes are caught rather than merged. */
const shapeOf = (t: ResultTable) =>
  t.columns.map((c) => `${c.kind}:${c.variableKey ?? c.measureKey ?? c.label}`).join("|");

export function stitchTables(sources: StitchSource[]): StitchResult | { error: string } {
  const usable = sources.filter((s) => s.table.rows.length > 0);
  if (usable.length === 0) return { error: "No data was returned for any part of the period." };

  const shape = shapeOf(usable[0].table);
  const mismatch = usable.find((s) => shapeOf(s.table) !== shape);
  if (mismatch) {
    return {
      error: `The ${mismatch.databaseId} results have a different column layout from the others, so they cannot be joined.`,
    };
  }

  const columns = usable[0].table.columns;
  const yearIdx = columns.findIndex((c) => c.variableKey === "year");

  const rows: ResultCell[][] = [];
  const rowIsTotal: boolean[] = [];
  const provenance: { databaseId: string; years: string[] }[] = [];

  for (const s of usable) {
    const years = new Set<string>();
    s.table.rows.forEach((r, i) => {
      // Per-source totals are meaningless once joined — they would total a
      // slice of the period and sit in the middle of the series.
      if (s.table.rowIsTotal[i]) return;
      rows.push(r);
      rowIsTotal.push(false);
      if (yearIdx >= 0) years.add(cellLabel(r[yearIdx]));
    });
    provenance.push({ databaseId: s.databaseId, years: [...years].sort() });
  }

  // Chronological, so a trend reads left to right regardless of the order the
  // sources happened to return in.
  if (yearIdx >= 0) {
    const yearOf = (r: ResultCell[]) => parseInt(cellLabel(r[yearIdx]), 10) || 0;
    const order = rows.map((_, i) => i).sort((a, b) => yearOf(rows[a]) - yearOf(rows[b]));
    const sorted = order.map((i) => rows[i]);
    rows.length = 0;
    rows.push(...sorted);
  }

  const caveats = [
    ...new Set(usable.flatMap((s) => s.table.caveats)),
  ];

  return {
    table: { columns, rows, rowIsTotal, caveats, rowCount: rows.length },
    provenance,
  };
}

/**
 * Fill in an age-adjusted rate that a source could not supply.
 *
 * The provisional file publishes no age-adjusted rate, so it is computed from a
 * companion query grouped by age. `keyOf` reduces a row to the grouping it
 * belongs to, ignoring the age column, so the strata for each group can be
 * gathered back together.
 */
export function spliceAdjustedRates(
  table: ResultTable,
  adjustedByKey: Map<string, number>,
  keyOf: (row: ResultCell[], columns: ResultTable["columns"]) => string,
  measure: MeasureKey = "ageAdjustedRate",
): ResultTable {
  const idx = table.columns.findIndex((c) => c.measureKey === measure);
  if (idx < 0) return table;
  const rows = table.rows.map((r) => {
    const existing = cellNumber(r[idx]);
    // Only fill gaps. A rate the source did publish is authoritative.
    if (existing !== null) return r;
    const value = adjustedByKey.get(keyOf(r, table.columns));
    if (value === undefined) return r;
    const next = [...r];
    next[idx] = { value, raw: value.toFixed(3), flag: undefined };
    return next;
  });
  return { ...table, rows };
}

/**
 * Give a table a measure column it does not have, filled with blanks.
 *
 * The provisional file cannot return an age-adjusted rate, so its table comes
 * back one column narrower than the others and the join refuses it — correctly,
 * since a layout mismatch is normally a sign that values would land in the
 * wrong column. Here the mismatch is expected, and the column is added so the
 * computed rates have somewhere to go and the shapes line up.
 */
export function ensureMeasureColumn(
  table: ResultTable,
  measureKey: MeasureKey,
  label: string,
): ResultTable {
  if (table.columns.some((c) => c.measureKey === measureKey)) return table;
  return {
    ...table,
    columns: [
      ...table.columns,
      { key: `m_${measureKey}`, label, kind: "measure", measureKey },
    ],
    rows: table.rows.map((r) => [...r, { value: null, raw: "" }]),
  };
}
