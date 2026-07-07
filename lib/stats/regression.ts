// Linear regression with r², and p-value for the slope (t-test). Works on
// (x, y) pairs extracted from result tables. For grouped/aggregated WONDER data
// callers should pass appropriate x encodings (e.g. age-group midpoints).

import { linearRegression, linearRegressionLine, rSquared } from "simple-statistics";
import { studentTwoSidedP } from "./dist";

export interface RegressionResult {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
  pValue: number | null; // null when n < 3
  se: number | null; // standard error of slope
  line: (x: number) => number;
}

export function computeRegression(pairs: [number, number][]): RegressionResult | null {
  const clean = pairs.filter(
    ([x, y]) => Number.isFinite(x) && Number.isFinite(y),
  );
  const n = clean.length;
  if (n < 2) return null;

  const mb = linearRegression(clean);
  const line = linearRegressionLine(mb);
  const r2 = rSquared(clean, line);

  let pValue: number | null = null;
  let se: number | null = null;
  if (n >= 3) {
    // SE of slope = sqrt( SSE/(n-2) / Sxx )
    const meanX = clean.reduce((s, [x]) => s + x, 0) / n;
    const sxx = clean.reduce((s, [x]) => s + (x - meanX) ** 2, 0);
    const sse = clean.reduce((s, [x, y]) => s + (y - line(x)) ** 2, 0);
    if (sxx > 0 && sse >= 0) {
      const s2 = sse / (n - 2);
      se = Math.sqrt(s2 / sxx);
      if (se > 0) {
        const t = mb.m / se;
        pValue = studentTwoSidedP(t, n - 2);
      } else {
        pValue = 0; // perfect fit
      }
    }
  }

  return { slope: mb.m, intercept: mb.b, r2, n, pValue, se, line };
}

/** Midpoint encoding for WONDER age-group labels ("15-24 years", "85+ years", "< 1 year"). */
export function ageGroupMidpoint(label: string): number | null {
  const t = label.trim();
  if (/^<\s*1/.test(t)) return 0.5;
  const range = t.match(/^(\d+)\s*-\s*(\d+)/);
  if (range) return (parseInt(range[1], 10) + parseInt(range[2], 10)) / 2;
  const plus = t.match(/^(\d+)\+/);
  if (plus) return parseInt(plus[1], 10) + 5; // open-ended: nudge past the floor
  const single = t.match(/^(\d+)/);
  if (single) return parseInt(single[1], 10);
  return null;
}

/** Month encoding: "Jan., 2019" / "2019/01" style labels -> sequential month number. */
export function monthOrdinal(label: string): number | null {
  const months = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ];
  const lower = label.toLowerCase();
  for (let i = 0; i < 12; i++) {
    if (lower.includes(months[i])) {
      const yr = label.match(/(\d{4})/);
      return yr ? parseInt(yr[1], 10) * 12 + i : i + 1;
    }
  }
  const ym = label.match(/(\d{4})\/(\d{1,2})/);
  if (ym) return parseInt(ym[1], 10) * 12 + parseInt(ym[2], 10) - 1;
  return null;
}
