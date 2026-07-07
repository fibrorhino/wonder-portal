// Correlation and association tests for aggregated WONDER tables.
// - Pearson / Spearman on numeric pairs
// - Chi-square test of independence on a contingency table built from two
//   categorical dimensions with death counts as cell weights (the correct
//   approach for aggregated count data — we never see individual decedents).

import { sampleCorrelation } from "simple-statistics";
import { chiSquareUpperP } from "./dist";

export interface ChiSquareResult {
  chi2: number;
  df: number;
  pValue: number;
  n: number;
  rows: string[];
  cols: string[];
  observed: number[][];
  expected: number[][];
  cramersV: number;
}

/**
 * Chi-square test of independence from long-format rows:
 * each entry = (rowCategory, colCategory, count).
 */
export function chiSquareFromCounts(
  entries: { row: string; col: string; count: number }[],
): ChiSquareResult | null {
  const rowSet = [...new Set(entries.map((e) => e.row))];
  const colSet = [...new Set(entries.map((e) => e.col))];
  if (rowSet.length < 2 || colSet.length < 2) return null;

  const observed = rowSet.map(() => colSet.map(() => 0));
  for (const e of entries) {
    const i = rowSet.indexOf(e.row);
    const j = colSet.indexOf(e.col);
    if (Number.isFinite(e.count)) observed[i][j] += e.count;
  }

  const rowTotals = observed.map((r) => r.reduce((a, b) => a + b, 0));
  const colTotals = colSet.map((_, j) =>
    observed.reduce((a, r) => a + r[j], 0),
  );
  const n = rowTotals.reduce((a, b) => a + b, 0);
  if (n === 0) return null;

  let chi2 = 0;
  const expected = observed.map((row, i) =>
    row.map((obs, j) => {
      const exp = (rowTotals[i] * colTotals[j]) / n;
      if (exp > 0) chi2 += (obs - exp) ** 2 / exp;
      return exp;
    }),
  );

  const df = (rowSet.length - 1) * (colSet.length - 1);
  const pValue = chiSquareUpperP(chi2, df);
  const k = Math.min(rowSet.length, colSet.length);
  const cramersV = k > 1 ? Math.sqrt(chi2 / (n * (k - 1))) : 0;

  return { chi2, df, pValue, n, rows: rowSet, cols: colSet, observed, expected, cramersV };
}

export function pearson(pairs: [number, number][]): number | null {
  const clean = pairs.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (clean.length < 3) return null;
  return sampleCorrelation(clean.map((p) => p[0]), clean.map((p) => p[1]));
}

export function spearman(pairs: [number, number][]): number | null {
  const clean = pairs.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (clean.length < 3) return null;
  const rank = (vals: number[]): number[] => {
    const sorted = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const ranks = Array(vals.length).fill(0);
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1][0] === sorted[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[sorted[k][1]] = avg;
      i = j + 1;
    }
    return ranks;
  };
  const rx = rank(clean.map((p) => p[0]));
  const ry = rank(clean.map((p) => p[1]));
  return sampleCorrelation(rx, ry);
}
