import test from "node:test";
import assert from "node:assert/strict";
import { decomposeSeasonality, describeSeasonality, type MonthlyPoint } from "./seasonality";

const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const AVERAGE_MONTH = 365.25 / 12;

/** Five years with a planted January peak, July trough, and a rising trend. */
function synthetic(): MonthlyPoint[] {
  const shape = [1.2, 1.1, 1.05, 1.0, 0.95, 0.9, 0.85, 0.9, 0.95, 1.0, 1.05, 1.15];
  const out: MonthlyPoint[] = [];
  for (let y = 0; y < 5; y++) {
    for (let m = 0; m < 12; m++) {
      // A trend underneath, so the decomposition has to separate the two.
      const trend = 1000 * 1.02 ** (y + m / 12);
      // Pre-multiplied by month length, because the decomposition divides it
      // back out — otherwise the recovered index would be shape x days.
      out.push({
        month: m,
        year: 2015 + y,
        value: (trend * shape[m] * DAYS[m]) / AVERAGE_MONTH,
        label: `${m}/${2015 + y}`,
      });
    }
  }
  return out;
}

test("a known seasonal shape is recovered from underneath a trend", () => {
  const d = decomposeSeasonality(synthetic());
  assert.ok(d);
  assert.equal(d.seasonal.length, 12);
  assert.equal(d.peak.name, "January");
  assert.equal(d.trough.name, "July");
  // The planted swing is 1.2 / 0.85 = 1.41.
  assert.ok(Math.abs(d.amplitude - 1.2 / 0.85) < 0.05, `amplitude ${d.amplitude}`);
  assert.ok(Math.abs(d.seasonal[0].index - 1.2) < 0.03, `Jan ${d.seasonal[0].index}`);
});

test("the twelve indices average to one, so the adjusted series keeps its level", () => {
  const d = decomposeSeasonality(synthetic());
  assert.ok(d);
  const mean = d.seasonal.reduce((a, s) => a + s.index, 0) / 12;
  assert.ok(Math.abs(mean - 1) < 1e-9, `mean ${mean}`);
});

test("deseasonalising removes the swing and leaves a smooth climb", () => {
  const d = decomposeSeasonality(synthetic());
  assert.ok(d);
  const vals = d.adjusted.map((a) => a.value);
  let reversals = 0;
  for (let i = 2; i < vals.length; i++) {
    const a = vals[i - 1] - vals[i - 2];
    const b = vals[i] - vals[i - 1];
    if (a * b < 0) reversals++;
  }
  assert.ok(reversals < vals.length / 4, `${reversals} reversals in ${vals.length}`);
});

test("month length is corrected, so February is not a false trough", () => {
  // A perfectly flat rate per DAY. Without the correction February looks 10%
  // low purely for being short, and that would be reported as seasonality.
  const flat: MonthlyPoint[] = [];
  for (let y = 0; y < 4; y++) {
    for (let m = 0; m < 12; m++) {
      flat.push({ month: m, year: 2015 + y, value: 100 * DAYS[m], label: `${m}` });
    }
  }
  const d = decomposeSeasonality(flat);
  assert.ok(d);
  for (const s of d.seasonal) {
    assert.ok(Math.abs(s.index - 1) < 0.01, `${s.name} index ${s.index}`);
  }
});

test("one extreme year does not redefine a month", () => {
  // The median across years is used rather than the mean, so a single
  // pandemic April cannot rewrite April's index.
  const base = synthetic();
  const spiked = base.map((p) =>
    p.year === 2017 && p.month === 3 ? { ...p, value: p.value * 3 } : p,
  );
  const clean = decomposeSeasonality(base);
  const shocked = decomposeSeasonality(spiked);
  assert.ok(clean && shocked);
  const april = (d: typeof clean) => d.seasonal[3].index;
  assert.ok(Math.abs(april(clean) - april(shocked)) < 0.05, "April survives the shock");
});

test("fewer than two years yields nothing rather than an invented pattern", () => {
  const oneYear: MonthlyPoint[] = Array.from({ length: 12 }, (_, m) => ({
    month: m,
    year: 2020,
    value: 100,
    label: `${m}`,
  }));
  assert.equal(decomposeSeasonality(oneYear), null);
  assert.equal(decomposeSeasonality([]), null);
});

test("the description names the peak, the trough and the size of the swing", () => {
  const d = decomposeSeasonality(synthetic());
  assert.ok(d);
  const text = describeSeasonality(d);
  assert.match(text, /January/);
  assert.match(text, /July/);
  assert.match(text, /fold swing/);
});
