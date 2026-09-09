// Classical seasonal decomposition for monthly mortality series.
//
// Deaths are strongly seasonal — winter respiratory and cardiovascular deaths
// lift January well above July — and suicide has its own, opposite and much
// smaller pattern, peaking in late spring. Both are invisible in a raw monthly
// chart because the seasonal swing is larger than the trend it hides.
//
// This is the classical multiplicative decomposition: a centred 12-month moving
// average as the trend, the ratio of each observation to that trend averaged by
// calendar month to give the seasonal index, and whatever is left as residual.
// Multiplicative rather than additive because a seasonal effect on deaths
// scales with the level of the series, not with a fixed number of deaths.
//
// Months differ in length, and February by nearly 10%, which would otherwise
// show up as a "seasonal" dip that is really just a short month. Counts are
// normalised to a 30.4-day month before anything else happens.

export interface MonthlyPoint {
  /** Calendar month, 0 = January. */
  month: number;
  year: number;
  value: number;
  label: string;
}

export interface SeasonalIndex {
  month: number;
  name: string;
  /** 1.08 means this month runs 8% above the annual average. */
  index: number;
  /** How many observations of this month contributed. */
  n: number;
}

export interface Decomposition {
  seasonal: SeasonalIndex[];
  /** Deseasonalised series: the observation divided by its month's index. */
  adjusted: { label: string; value: number }[];
  /** Highest and lowest months. */
  peak: SeasonalIndex;
  trough: SeasonalIndex;
  /** Peak index / trough index — the size of the seasonal swing. */
  amplitude: number;
  /** Complete years used; the decomposition needs at least two. */
  yearsUsed: number;
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAYS_IN_MONTH = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const AVERAGE_MONTH = 365.25 / 12;

/**
 * Decompose a monthly series.
 *
 * @returns null when there are fewer than two complete years, since a seasonal
 *   index averaged over a single observation per month is just the data back
 *   again with no information added.
 */
export function decomposeSeasonality(points: MonthlyPoint[]): Decomposition | null {
  const usable = points
    .filter((p) => Number.isFinite(p.value) && p.month >= 0 && p.month < 12)
    .sort((a, b) => a.year - b.year || a.month - b.month);
  if (usable.length < 24) return null;

  // Month length first: February is 10% shorter than January, and without this
  // that shows up as a seasonal dip that is really a calendar artefact.
  const normalised = usable.map((p) => ({
    ...p,
    value: (p.value / DAYS_IN_MONTH[p.month]) * AVERAGE_MONTH,
  }));

  // Centred 12-month moving average. An even window needs half-weights at both
  // ends so the average sits on a month rather than between two.
  const trend: (number | null)[] = normalised.map((_, i) => {
    if (i < 6 || i > normalised.length - 7) return null;
    let sum = 0.5 * normalised[i - 6].value + 0.5 * normalised[i + 6].value;
    for (let k = -5; k <= 5; k++) sum += normalised[i + k].value;
    return sum / 12;
  });

  // Ratio to trend, gathered by calendar month.
  const byMonth = new Map<number, number[]>();
  normalised.forEach((p, i) => {
    const t = trend[i];
    if (t === null || !(t > 0)) return;
    const ratio = p.value / t;
    byMonth.set(p.month, [...(byMonth.get(p.month) ?? []), ratio]);
  });
  if (byMonth.size < 12) return null;

  // Median rather than mean: one pandemic spring should not redefine April.
  const raw = new Map<number, { index: number; n: number }>();
  for (const [m, ratios] of byMonth) {
    const sorted = [...ratios].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    raw.set(m, { index: median, n: ratios.length });
  }

  // Normalise so the twelve indices average exactly 1, or the "adjusted"
  // series would sit at the wrong level.
  const mean = [...raw.values()].reduce((a, b) => a + b.index, 0) / raw.size;
  const seasonal: SeasonalIndex[] = [...raw.entries()]
    .map(([month, v]) => ({
      month,
      name: MONTH_NAMES[month],
      index: v.index / mean,
      n: v.n,
    }))
    .sort((a, b) => a.month - b.month);

  const indexOf = new Map(seasonal.map((s) => [s.month, s.index]));
  const adjusted = normalised.map((p) => ({
    label: p.label,
    value: p.value / (indexOf.get(p.month) ?? 1),
  }));

  const ranked = [...seasonal].sort((a, b) => b.index - a.index);
  const peak = ranked[0];
  const trough = ranked[ranked.length - 1];

  return {
    seasonal,
    adjusted,
    peak,
    trough,
    amplitude: trough.index > 0 ? peak.index / trough.index : 1,
    yearsUsed: new Set(usable.map((p) => p.year)).size,
  };
}

/** "January runs 9% above the yearly average, September 7% below" */
export function describeSeasonality(d: Decomposition): string {
  const pctOf = (index: number) => `${Math.abs((index - 1) * 100).toFixed(0)}%`;
  const dir = (index: number) => (index >= 1 ? "above" : "below");
  return (
    `${d.peak.name} runs ${pctOf(d.peak.index)} ${dir(d.peak.index)} the yearly average ` +
    `and ${d.trough.name} ${pctOf(d.trough.index)} ${dir(d.trough.index)}, ` +
    `a ${d.amplitude.toFixed(2)}-fold swing across the year`
  );
}
