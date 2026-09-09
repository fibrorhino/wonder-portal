// Uncertainty for rates and rate ratios.
//
// The analysis states things like "3.9-fold across this breakdown" with no
// indication of how firmly. For a group with 200 deaths that ratio is solid;
// for one with 12 it is barely distinguishable from no difference at all, and
// the sentence reads identically either way. These functions supply the
// interval that makes the difference visible.
//
// Deaths are treated as Poisson, which is the standard assumption for counts of
// rare events in a large population and the one CDC itself uses for the
// confidence intervals it publishes.

/** 1.959964: the normal quantile for a two-sided 95% interval. */
const Z95 = 1.959963984540054;

export interface Interval {
  low: number;
  high: number;
}

export interface RateWithCi {
  rate: number;
  ci: Interval;
  deaths: number;
  population: number;
}

/**
 * Poisson confidence interval for a rate.
 *
 * Uses the Byar approximation, which CDC/NCHS use for counts of 100 or more and
 * which stays close to the exact interval well below that. Below about 20
 * deaths the interval is wide and asymmetric, which is the honest signal that
 * the rate should not be quoted.
 */
export function rateCi(deaths: number, population: number, per = 100000): RateWithCi | null {
  if (!(population > 0) || deaths < 0 || !Number.isFinite(deaths)) return null;
  const rate = (deaths / population) * per;
  if (deaths === 0) {
    // No deaths: the lower bound is zero and the upper comes from the Poisson
    // tail, so the interval is one-sided rather than undefined.
    return { rate, deaths, population, ci: { low: 0, high: (3.0 / population) * per } };
  }
  const d = deaths;
  const lowCount = d * (1 - 1 / (9 * d) - Z95 / (3 * Math.sqrt(d))) ** 3;
  const highCount = (d + 1) * (1 - 1 / (9 * (d + 1)) + Z95 / (3 * Math.sqrt(d + 1))) ** 3;
  return {
    rate,
    deaths,
    population,
    ci: { low: (lowCount / population) * per, high: (highCount / population) * per },
  };
}

export interface RateRatio {
  ratio: number;
  ci: Interval;
  /** True when the interval excludes 1, i.e. the groups differ at the 5% level. */
  significant: boolean;
  numerator: { deaths: number; population: number; rate: number };
  denominator: { deaths: number; population: number; rate: number };
}

/**
 * Ratio of two rates, with a confidence interval.
 *
 * The interval is built on the log scale — the ratio's sampling distribution is
 * skewed, so a symmetric interval around the ratio itself would put the lower
 * bound in the wrong place and could even run below zero.
 */
export function rateRatio(
  a: { deaths: number; population: number },
  b: { deaths: number; population: number },
  per = 100000,
): RateRatio | null {
  if (!(a.population > 0) || !(b.population > 0)) return null;
  // A zero in either arm makes the log ratio infinite; there is no interval to
  // report, and saying nothing is better than saying "infinitely higher".
  if (!(a.deaths > 0) || !(b.deaths > 0)) return null;

  const rateA = (a.deaths / a.population) * per;
  const rateB = (b.deaths / b.population) * per;
  const ratio = rateA / rateB;

  const seLog = Math.sqrt(1 / a.deaths + 1 / b.deaths);
  const low = ratio * Math.exp(-Z95 * seLog);
  const high = ratio * Math.exp(Z95 * seLog);

  return {
    ratio,
    ci: { low, high },
    significant: low > 1 || high < 1,
    numerator: { ...a, rate: rateA },
    denominator: { ...b, rate: rateB },
  };
}

/**
 * Parse the confidence interval WONDER returns alongside a rate, e.g.
 * "(10.4 - 10.5)". Its own intervals are already there in the response and
 * were being kept as text and never used.
 */
export function parseWonderCi(text: string | undefined): Interval | null {
  if (!text) return null;
  const m = text.match(/\(?\s*(-?[\d.,]+)\s*[–—-]\s*(-?[\d.,]+)\s*\)?/);
  if (!m) return null;
  const low = Number(m[1].replace(/,/g, ""));
  const high = Number(m[2].replace(/,/g, ""));
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  return { low, high };
}

/** "2.41 (95% CI 2.29–2.54)" */
export function formatRatio(r: RateRatio, digits = 2): string {
  const f = (n: number) => n.toFixed(digits);
  return `${f(r.ratio)} (95% CI ${f(r.ci.low)}–${f(r.ci.high)})`;
}
