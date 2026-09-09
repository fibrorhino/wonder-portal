import test from "node:test";
import assert from "node:assert/strict";
import { formatRatio, parseWonderCi, rateCi, rateRatio } from "./rates";

test("a rate interval is wide when the count is small and tight when it is large", () => {
  // Same rate, hundredfold difference in count. The point estimate alone cannot
  // tell these apart; the interval is the whole reason to show it.
  const few = rateCi(10, 100_000);
  const many = rateCi(1000, 10_000_000);
  assert.ok(few && many);
  assert.ok(Math.abs(few.rate - many.rate) < 1e-9, "same rate");
  const widthFew = few.ci.high - few.ci.low;
  const widthMany = many.ci.high - many.ci.low;
  assert.ok(widthFew > widthMany * 5, `few ${widthFew} vs many ${widthMany}`);
  assert.ok(few.ci.low < few.rate && few.rate < few.ci.high);
});

test("zero deaths gives a one-sided interval rather than nothing", () => {
  const r = rateCi(0, 1_000_000);
  assert.ok(r);
  assert.equal(r.rate, 0);
  assert.equal(r.ci.low, 0);
  assert.ok(r.ci.high > 0, "an upper bound still exists");
});

test("a rate ratio's interval is asymmetric, because the ratio is", () => {
  const rr = rateRatio(
    { deaths: 100, population: 1_000_000 },
    { deaths: 50, population: 1_000_000 },
  );
  assert.ok(rr);
  assert.ok(Math.abs(rr.ratio - 2) < 1e-9);
  // Built on the log scale, so the ratio sits at the geometric centre of its
  // interval rather than the arithmetic one.
  const geometric = Math.sqrt(rr.ci.low * rr.ci.high);
  assert.ok(Math.abs(geometric - rr.ratio) < 1e-9, "ratio is the geometric centre");
  assert.ok(rr.ci.high - rr.ratio > rr.ratio - rr.ci.low, "upper arm is longer");
});

test("a difference on small counts is reported as not significant", () => {
  // Twofold on 4 deaths against 2 is nothing; on 400 against 200 it is real.
  // The point estimates are identical, so only the interval separates them.
  const small = rateRatio(
    { deaths: 4, population: 100_000 },
    { deaths: 2, population: 100_000 },
  );
  const large = rateRatio(
    { deaths: 400, population: 10_000_000 },
    { deaths: 200, population: 10_000_000 },
  );
  assert.ok(small && large);
  assert.ok(Math.abs(small.ratio - large.ratio) < 1e-9, "identical point estimates");
  assert.equal(small.significant, false);
  assert.equal(large.significant, true);
});

test("a zero in either arm yields no ratio at all", () => {
  // The log ratio is infinite, and "infinitely higher" is not a finding.
  assert.equal(rateRatio({ deaths: 0, population: 1e6 }, { deaths: 10, population: 1e6 }), null);
  assert.equal(rateRatio({ deaths: 10, population: 1e6 }, { deaths: 0, population: 1e6 }), null);
});

test("WONDER's own confidence intervals are parsed out of the response text", () => {
  assert.deepEqual(parseWonderCi("(10.4 - 10.5)"), { low: 10.4, high: 10.5 });
  assert.deepEqual(parseWonderCi("(1,025.9 - 1,028.1)"), { low: 1025.9, high: 1028.1 });
  assert.equal(parseWonderCi(undefined), null);
  assert.equal(parseWonderCi("Unreliable"), null);
});

test("a ratio formats with its interval", () => {
  const rr = rateRatio({ deaths: 400, population: 1e7 }, { deaths: 200, population: 1e7 });
  assert.ok(rr);
  assert.match(formatRatio(rr), /^2\.00 \(95% CI \d\.\d\d–\d\.\d\d\)$/);
});
