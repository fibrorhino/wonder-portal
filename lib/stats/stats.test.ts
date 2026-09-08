// Numerical regression tests for the statistics used in the Stats tab.
// Run with `npm test` (Node's built-in test runner + native TS type-stripping;
// no test framework dependency).
//
// Reference values are from standard t / chi-square / F tables, cross-checked
// against direct numeric integration of the densities.

import test from "node:test";
import assert from "node:assert/strict";
import {
  chiSquareUpperP,
  fUpperP,
  logGamma,
  studentTwoSidedP,
} from "./dist";
import { computeRegression, ageGroupMidpoint } from "./regression";
import { chiSquareFromCounts, pearson, spearman } from "./correlation";
import { oneWayAnova, trend } from "./summary";

const closeTo = (actual: number, expected: number, tol: number, msg: string) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg}: got ${actual}, expected ${expected} (±${tol})`,
  );

test("studentTwoSidedP matches published t-table values", () => {
  closeTo(studentTwoSidedP(2.228, 10), 0.05, 1e-4, "t=2.228, df=10");
  closeTo(studentTwoSidedP(3.0, 20), 0.00707, 1e-4, "t=3, df=20");
  closeTo(studentTwoSidedP(1.0, 10), 0.3409, 1e-4, "t=1, df=10");
  closeTo(studentTwoSidedP(1.5, 5), 0.19393, 1e-4, "t=1.5, df=5");
  closeTo(studentTwoSidedP(0.5, 100), 0.61817, 1e-4, "t=0.5, df=100");
});

// Regression guard: the incomplete-beta continued fraction stalls for
// x > (a+1)/(a+b+2) unless the symmetry transform is applied. A near-zero t
// puts x close to 1, and the un-transformed version returned p ~ 0.01 —
// reporting a perfectly flat trend as "significant at alpha = 0.05".
test("studentTwoSidedP returns p ~ 1 for a near-zero t statistic", () => {
  for (const df of [3, 5, 8, 10, 20, 50, 200]) {
    closeTo(studentTwoSidedP(1e-4, df), 1.0, 1e-3, `t~0, df=${df}`);
  }
});

test("studentTwoSidedP decreases monotonically as |t| grows", () => {
  for (const df of [3, 10, 30]) {
    let prev = Infinity;
    for (let t = 0; t <= 5; t += 0.05) {
      const p = studentTwoSidedP(t, df);
      assert.ok(
        p <= prev + 1e-9,
        `p increased at t=${t.toFixed(2)}, df=${df}: ${p} > ${prev}`,
      );
      prev = p;
    }
  }
});

test("chiSquareUpperP matches published chi-square values", () => {
  closeTo(chiSquareUpperP(3.841, 1), 0.05, 1e-4, "chi2=3.841, df=1");
  closeTo(chiSquareUpperP(5.991, 2), 0.05, 1e-4, "chi2=5.991, df=2");
  closeTo(chiSquareUpperP(0.5, 1), 0.4795, 1e-4, "chi2=0.5, df=1");
  closeTo(chiSquareUpperP(20, 3), 1.6974e-4, 1e-8, "chi2=20, df=3");
});

// Regression guard: computing the upper tail as `1 - lower` collapses to
// exactly 0 once the true p drops below machine epsilon.
test("chiSquareUpperP stays non-zero deep in the tail", () => {
  const p100 = chiSquareUpperP(100, 1);
  assert.ok(p100 > 0, "chi2=100, df=1 returned exactly 0");
  closeTo(p100 / 1.52397e-23, 1, 1e-4, "chi2=100, df=1 (relative)");

  const p200 = chiSquareUpperP(200, 10);
  assert.ok(p200 > 0, "chi2=200, df=10 returned exactly 0");
  closeTo(p200 / 1.61393e-37, 1, 1e-4, "chi2=200, df=10 (relative)");
});

test("fUpperP matches published F values and the reciprocal identity", () => {
  closeTo(fUpperP(4.9646, 1, 10), 0.05, 1e-4, "F=4.9646, df=(1,10)");
  closeTo(fUpperP(1, 5, 5), 0.5, 1e-9, "F=1, df=(5,5)");
  // P(F_{a,b} > f) + P(F_{b,a} > 1/f) == 1
  for (const [f, a, b] of [
    [0.2, 5, 5],
    [3.49, 3, 20],
    [0.7, 4, 9],
  ] as const) {
    closeTo(fUpperP(f, a, b) + fUpperP(1 / f, b, a), 1, 1e-9, `reciprocal f=${f}`);
  }
});

test("logGamma matches known factorials", () => {
  closeTo(logGamma(1), 0, 1e-10, "logGamma(1)");
  closeTo(logGamma(5), Math.log(24), 1e-10, "logGamma(5) = ln 4!");
  closeTo(logGamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-10, "logGamma(0.5)");
});

test("computeRegression recovers a known line", () => {
  const reg = computeRegression([
    [1, 3],
    [2, 5],
    [3, 7],
    [4, 9],
  ]);
  assert.ok(reg);
  closeTo(reg.slope, 2, 1e-9, "slope");
  closeTo(reg.intercept, 1, 1e-9, "intercept");
  closeTo(reg.r2, 1, 1e-9, "r2");
  assert.equal(reg.n, 4);
});

test("computeRegression reports a flat series as non-significant", () => {
  // Identical y at every x: zero slope, and the p-value must not claim
  // significance (this is the case the incomplete-beta bug got wrong).
  const reg = computeRegression([
    [2018, 100],
    [2019, 100],
    [2020, 100],
    [2021, 100],
    [2022, 100],
  ]);
  assert.ok(reg);
  closeTo(reg.slope, 0, 1e-9, "slope of flat series");
  assert.ok(
    reg.pValue === null || reg.pValue > 0.05,
    `flat series reported as significant: p=${reg.pValue}`,
  );
  // r2 is 0/0 for a constant series; it must not reach the UI as NaN.
  assert.ok(Number.isFinite(reg.r2), `r2 is not finite: ${reg.r2}`);
});

test("computeRegression drops non-finite pairs and needs 2+ points", () => {
  assert.equal(computeRegression([[1, 2]]), null);
  assert.equal(computeRegression([[NaN, 2], [1, NaN]]), null);
});

test("ageGroupMidpoint parses WONDER age labels", () => {
  assert.equal(ageGroupMidpoint("15-24 years"), 19.5);
  assert.equal(ageGroupMidpoint("< 1 year"), 0.5);
  assert.equal(ageGroupMidpoint("85+ years"), 90);
  assert.equal(ageGroupMidpoint("Not Stated"), null);
});

test("chiSquareFromCounts reproduces a hand-computed 2x2", () => {
  // Observed [[10, 20], [30, 40]] -> expected [[12, 18], [28, 42]].
  // Pearson chi2 = 4*(1/12 + 1/18 + 1/28 + 1/42) = 0.793651 (no Yates
  // continuity correction, which is the right choice for the large tables
  // WONDER returns).
  const res = chiSquareFromCounts([
    { row: "a", col: "x", count: 10 },
    { row: "a", col: "y", count: 20 },
    { row: "b", col: "x", count: 30 },
    { row: "b", col: "y", count: 40 },
  ]);
  assert.ok(res);
  assert.equal(res.df, 1);
  assert.equal(res.n, 100);
  closeTo(res.chi2, 0.793651, 1e-5, "chi2");
  closeTo(res.pValue, 0.372998, 1e-5, "p");
  closeTo(res.cramersV, Math.sqrt(0.793651 / 100), 1e-6, "Cramer's V");
  assert.deepEqual(res.expected, [
    [12, 18],
    [28, 42],
  ]);
});

test("chiSquareFromCounts needs a 2x2 minimum", () => {
  assert.equal(
    chiSquareFromCounts([{ row: "a", col: "x", count: 5 }]),
    null,
  );
});

test("oneWayAnova matches a hand-computed example", () => {
  // Groups (1,2,3), (4,5,6), (7,8,9): SSb = 54, SSw = 6, F = 27.
  const res = oneWayAnova([
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ]);
  assert.ok(res);
  closeTo(res.f, 27, 1e-9, "F");
  assert.equal(res.dfBetween, 2);
  assert.equal(res.dfWithin, 6);
  closeTo(res.pValue, 0.001008, 1e-5, "p");
  closeTo(res.etaSquared, 54 / 60, 1e-9, "eta squared");
});

test("oneWayAnova reports identical groups as non-significant", () => {
  const res = oneWayAnova([
    [5, 5, 5],
    [5, 5, 5],
  ]);
  assert.ok(res);
  assert.ok(
    res.pValue > 0.05,
    `identical groups reported as significant: p=${res.pValue}`,
  );
});

test("trend computes total change and CAGR", () => {
  const tr = trend([
    { label: "2019", value: 100 },
    { label: "2020", value: 110 },
    { label: "2021", value: 121 },
  ]);
  assert.ok(tr);
  closeTo(tr.totalChangePct, 21, 1e-9, "total change %");
  closeTo(tr.cagrPct, 10, 1e-9, "CAGR %");
  assert.equal(tr.periods, 2);
});

test("correlation returns null, not NaN, when a series has no variance", () => {
  // Zero variance makes correlation 0/0. NaN is not null, so a `?? "n/a"`
  // fallback in the UI would have rendered the literal text "NaN".
  const flatY: [number, number][] = [
    [2019, 500],
    [2020, 500],
    [2021, 500],
    [2022, 500],
  ];
  assert.equal(pearson(flatY), null, "pearson on a flat series");
  assert.equal(spearman(flatY), null, "spearman on a flat series");

  const flatX: [number, number][] = [
    [7, 1],
    [7, 2],
    [7, 3],
  ];
  assert.equal(pearson(flatX), null, "pearson with constant x");
  assert.equal(spearman(flatX), null, "spearman with constant x");
});

test("correlation still computes normally on varying data", () => {
  const rising: [number, number][] = [
    [1, 2],
    [2, 4],
    [3, 6],
    [4, 8],
  ];
  closeTo(pearson(rising)!, 1, 1e-9, "perfect positive correlation");
  closeTo(spearman(rising)!, 1, 1e-9, "perfect rank correlation");

  const falling: [number, number][] = [
    [1, 10],
    [2, 7],
    [3, 4],
    [4, 1],
  ];
  closeTo(pearson(falling)!, -1, 1e-9, "perfect negative correlation");
});
