// Side-by-side comparison of two result tables.
//
// The question this answers — "how does this group differ from that one?" —
// takes two separate WONDER queries, because the API returns one cross-tab at a
// time and a filter cannot be varied within a single request. So the app pins
// one result and diffs the next against it.
//
// Rows are matched on their dimension-label tuple, which is only meaningful
// when both queries grouped by the same variables in the same order. When they
// did not, the totals are still comparable and the row table is suppressed
// rather than aligned on coincidence.

import type { MeasureKey, ResultTable } from "../wonder/types";
import { cellLabel, cellNumber, dataRows, dimensionCols, measureCols } from "../tableUtils";

export interface ComparisonRow {
  key: string;
  labels: string[];
  a: number | null;
  b: number | null;
  diff: number | null;
  pctChange: number | null; // relative to A
}

export interface Comparison {
  /** True when the two tables share a grouping and rows could be aligned. */
  aligned: boolean;
  /** Set when the two results come from different datasets. */
  datasetMismatch?: { a: string; b: string };
  note?: string;
  dimensionLabels: string[];
  measureKey: MeasureKey;
  measureLabel: string;
  rows: ComparisonRow[];
  totals: { a: number | null; b: number | null; diff: number | null; pctChange: number | null };
  /** Categories present in only one of the two results. */
  onlyInA: string[];
  onlyInB: string[];
}

const MEASURE_PREFERENCE: MeasureKey[] = [
  "deaths",
  "ageAdjustedRate",
  "crudeRate",
  "population",
];

function pctChange(a: number | null, b: number | null): number | null {
  if (a === null || b === null || a === 0) return null;
  return ((b - a) / Math.abs(a)) * 100;
}

/** Sum a measure over each distinct combination of dimension values. */
function bucketize(table: ResultTable, measureIdx: number) {
  const dims = dimensionCols(table);
  const map = new Map<string, { labels: string[]; value: number | null }>();
  for (const row of dataRows(table)) {
    const labels = dims.map((d) => cellLabel(row[d.index]));
    const key = JSON.stringify(labels);
    const v = cellNumber(row[measureIdx]);
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { labels, value: v });
    } else if (v !== null) {
      cur.value = (cur.value ?? 0) + v;
    }
  }
  return map;
}

export function compareTables(
  a: ResultTable,
  b: ResultTable,
  preferred?: MeasureKey,
  datasets?: { a: string | undefined; b: string | undefined },
): Comparison | null {
  const aMeasures = measureCols(a);
  const bMeasures = measureCols(b);
  if (aMeasures.length === 0 || bMeasures.length === 0) return null;

  // Compare on a measure both results actually carry.
  const shared = MEASURE_PREFERENCE.filter(
    (m) =>
      aMeasures.some((c) => c.column.measureKey === m) &&
      bMeasures.some((c) => c.column.measureKey === m),
  );
  const measureKey = (preferred && shared.includes(preferred) ? preferred : shared[0]) ?? null;
  if (!measureKey) return null;

  const aIdx = aMeasures.find((c) => c.column.measureKey === measureKey)!.index;
  const bIdx = bMeasures.find((c) => c.column.measureKey === measureKey)!.index;
  const measureLabel = a.columns[aIdx].label;

  // A rate is an intensity, not a quantity: summing rates across rows is
  // meaningless, so a total is only offered for additive measures.
  const additive = measureKey === "deaths" || measureKey === "population";
  const sumOf = (t: ResultTable, i: number) => {
    const values = dataRows(t)
      .map((r) => cellNumber(r[i]))
      .filter((v): v is number => v !== null);
    return additive && values.length ? values.reduce((x, y) => x + y, 0) : null;
  };
  const totalA = sumOf(a, aIdx);
  const totalB = sumOf(b, bIdx);
  const totals = {
    a: totalA,
    b: totalB,
    diff: totalA !== null && totalB !== null ? totalB - totalA : null,
    pctChange: pctChange(totalA, totalB),
  };

  // Diffing final against provisional data compares like with unlike: the
  // provisional file undercounts recent periods and revises upward, so every
  // difference in the overlap is an artefact of processing lag rather than a
  // real change. Refused rather than shown with a warning, because the table
  // would look authoritative either way.
  if (datasets && datasets.a && datasets.b && datasets.a !== datasets.b) {
    return {
      aligned: false,
      datasetMismatch: { a: datasets.a, b: datasets.b },
      note: "These two results come from different datasets, so they cannot be compared. Provisional data undercounts recent periods and is revised upward, so any difference against the final file would reflect processing lag rather than a real change. Pin two results from the same dataset instead.",
      dimensionLabels: [],
      measureKey,
      measureLabel,
      rows: [],
      totals: { a: null, b: null, diff: null, pctChange: null },
      onlyInA: [],
      onlyInB: [],
    };
  }

  const aDims = dimensionCols(a).map((d) => d.column.variableKey ?? d.column.label);
  const bDims = dimensionCols(b).map((d) => d.column.variableKey ?? d.column.label);
  const sameGrouping =
    aDims.length === bDims.length && aDims.every((k, i) => k === bDims[i]);

  if (!sameGrouping) {
    return {
      aligned: false,
      note: `These queries group differently (${aDims.join(" × ") || "none"} vs ${bDims.join(" × ") || "none"}), so individual rows cannot be matched up. Only the totals are comparable.`,
      dimensionLabels: [],
      measureKey,
      measureLabel,
      rows: [],
      totals,
      onlyInA: [],
      onlyInB: [],
    };
  }

  const aMap = bucketize(a, aIdx);
  const bMap = bucketize(b, bIdx);
  const keys = [...new Set([...aMap.keys(), ...bMap.keys()])];

  const rows: ComparisonRow[] = keys.map((key) => {
    const ra = aMap.get(key);
    const rb = bMap.get(key);
    const av = ra?.value ?? null;
    const bv = rb?.value ?? null;
    return {
      key,
      labels: ra?.labels ?? rb?.labels ?? [],
      a: av,
      b: bv,
      diff: av !== null && bv !== null ? bv - av : null,
      pctChange: pctChange(av, bv),
    };
  });

  // Biggest absolute movement first — that is what a reader is looking for.
  rows.sort((x, y) => Math.abs(y.diff ?? -Infinity) - Math.abs(x.diff ?? -Infinity));

  return {
    aligned: true,
    dimensionLabels: dimensionCols(a).map((d) => d.column.label),
    measureKey,
    measureLabel,
    rows,
    totals,
    onlyInA: rows.filter((r) => r.b === null).map((r) => r.labels.join(" / ")),
    onlyInB: rows.filter((r) => r.a === null).map((r) => r.labels.join(" / ")),
  };
}
