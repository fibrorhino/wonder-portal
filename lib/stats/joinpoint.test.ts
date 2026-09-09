import test from "node:test";
import assert from "node:assert/strict";
import { fitTrend, describeApc } from "./joinpoint";

const series = (values: number[], startYear = 2010) =>
  values.map((y, i) => ({ x: startYear + i, y, label: String(startYear + i) }));

test("a constant proportional rise is recovered as its annual percent change", () => {
  // Exactly 5% per year, so the fit should return 5.0 and r2 = 1.
  const values = Array.from({ length: 10 }, (_, i) => 100 * 1.05 ** i);
  const fit = fitTrend(series(values), 0);
  assert.ok(fit);
  assert.equal(fit.segments.length, 1);
  assert.ok(Math.abs(fit.segments[0].apc - 5) < 1e-6, `apc ${fit.segments[0].apc}`);
  assert.ok(fit.r2 > 0.9999);
  assert.ok(Math.abs(fit.aapc - 5) < 1e-6);
});

test("a straight trend is not given a joinpoint it does not need", () => {
  const values = Array.from({ length: 12 }, (_, i) => 100 * 1.03 ** i);
  const fit = fitTrend(series(values), 2);
  assert.ok(fit);
  // BIC must refuse to pay for a bend that buys nothing.
  assert.deepEqual(fit.joinpoints, []);
  assert.equal(fit.segments.length, 1);
});

test("a real change of direction is found, and put in the right place", () => {
  // Up 8%/yr for six years from 2010, then down 6%/yr.
  const up = Array.from({ length: 6 }, (_, i) => 100 * 1.08 ** i);
  const turn = up[up.length - 1];
  const down = Array.from({ length: 6 }, (_, i) => turn * 0.94 ** (i + 1));
  const fit = fitTrend(series([...up, ...down]), 2);
  assert.ok(fit);
  assert.equal(fit.joinpoints.length, 1, "one bend");
  assert.equal(fit.joinpoints[0], 2015, `found ${fit.joinpoints[0]}`);
  assert.equal(fit.segments.length, 2);
  assert.ok(Math.abs(fit.segments[0].apc - 8) < 0.5, `rise ${fit.segments[0].apc}`);
  assert.ok(Math.abs(fit.segments[1].apc + 6) < 0.5, `fall ${fit.segments[1].apc}`);
  // Rising then falling over equal spans nets out near flat.
  assert.ok(Math.abs(fit.aapc) < 1.5, `aapc ${fit.aapc}`);
});

test("segments are reported with the labels the reader saw", () => {
  const up = Array.from({ length: 6 }, (_, i) => 100 * 1.08 ** i);
  const turn = up[up.length - 1];
  const down = Array.from({ length: 6 }, (_, i) => turn * 0.94 ** (i + 1));
  const fit = fitTrend(series([...up, ...down]), 2);
  assert.ok(fit);
  assert.equal(fit.segments[0].startLabel, "2010");
  assert.equal(fit.segments[0].endLabel, "2015");
  assert.equal(fit.segments[1].endLabel, "2021");
});

test("zero and negative values are dropped, since ln(y) is undefined there", () => {
  // A zero means "none recorded", not "a rate near zero".
  const fit = fitTrend(series([100, 0, 110, 120, 130, 140]), 0);
  assert.ok(fit);
  assert.equal(fit.n, 5);
});

test("too few points yields no fit rather than a meaningless one", () => {
  assert.equal(fitTrend(series([100, 110]), 0), null);
  assert.equal(fitTrend([], 0), null);
});

test("every segment keeps at least three points", () => {
  // With 7 points a second joinpoint cannot be afforded; the search must not
  // return a segment fitted through two observations.
  const fit = fitTrend(series([100, 130, 170, 220, 100, 60, 40]), 3);
  assert.ok(fit);
  for (const sg of fit.segments) {
    const span = sg.endX - sg.startX;
    assert.ok(span >= 2, `segment ${sg.startLabel}-${sg.endLabel} spans ${span}`);
  }
});

test("describeApc reads as a direction and a magnitude", () => {
  assert.equal(describeApc(2.34), "up 2.3% per year");
  assert.equal(describeApc(-2.34), "down 2.3% per year");
});
