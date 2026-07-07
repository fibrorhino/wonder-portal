// Descriptive statistics, one-way ANOVA, and time-trend summaries computed on
// aggregated WONDER cell values.

import { fUpperP } from "./dist";

export interface Describe {
  n: number;
  sum: number;
  mean: number;
  median: number;
  sd: number; // sample SD
  min: number;
  max: number;
}

export function describe(values: number[]): Describe | null {
  const v = values.filter((x) => Number.isFinite(x));
  const n = v.length;
  if (n === 0) return null;
  const sum = v.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const sorted = [...v].sort((a, b) => a - b);
  const median =
    n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const variance =
    n > 1 ? v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  return { n, sum, mean, median, sd: Math.sqrt(variance), min: sorted[0], max: sorted[n - 1] };
}

export interface AnovaResult {
  f: number;
  dfBetween: number;
  dfWithin: number;
  pValue: number;
  groups: number;
  etaSquared: number; // effect size (SS_between / SS_total)
}

/** One-way ANOVA across k groups of measurements. */
export function oneWayAnova(groups: number[][]): AnovaResult | null {
  const clean = groups.map((g) => g.filter(Number.isFinite)).filter((g) => g.length > 0);
  const k = clean.length;
  if (k < 2) return null;
  const all = clean.flat();
  const N = all.length;
  if (N <= k) return null;
  const grand = all.reduce((a, b) => a + b, 0) / N;

  let ssBetween = 0;
  let ssWithin = 0;
  for (const g of clean) {
    const mean = g.reduce((a, b) => a + b, 0) / g.length;
    ssBetween += g.length * (mean - grand) ** 2;
    for (const x of g) ssWithin += (x - mean) ** 2;
  }
  const dfBetween = k - 1;
  const dfWithin = N - k;
  const msB = ssBetween / dfBetween;
  const msW = ssWithin / dfWithin;
  const f = msW > 0 ? msB / msW : Infinity;
  const pValue = Number.isFinite(f) ? fUpperP(f, dfBetween, dfWithin) : 0;
  const ssTotal = ssBetween + ssWithin;
  return {
    f,
    dfBetween,
    dfWithin,
    pValue,
    groups: k,
    etaSquared: ssTotal > 0 ? ssBetween / ssTotal : 0,
  };
}

export interface TrendResult {
  first: number;
  last: number;
  firstLabel: string;
  lastLabel: string;
  totalChangePct: number;
  cagrPct: number; // compound annual growth rate over the span
  periods: number;
}

/** Trend over an ordered series of (label, value) points (e.g. by year). */
export function trend(points: { label: string; value: number }[]): TrendResult | null {
  const pts = points.filter((p) => Number.isFinite(p.value));
  if (pts.length < 2) return null;
  const first = pts[0].value;
  const last = pts[pts.length - 1].value;
  const periods = pts.length - 1;
  const totalChangePct = first !== 0 ? ((last - first) / first) * 100 : NaN;
  const cagrPct =
    first > 0 && last > 0 ? (Math.pow(last / first, 1 / periods) - 1) * 100 : NaN;
  return {
    first,
    last,
    firstLabel: pts[0].label,
    lastLabel: pts[pts.length - 1].label,
    totalChangePct,
    cagrPct,
    periods,
  };
}
