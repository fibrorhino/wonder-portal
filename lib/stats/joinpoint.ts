// Trend fitting for mortality time series: log-linear trend, and segmented
// ("joinpoint") regression that finds where the trend changed.
//
// Mortality trends are reported as an ANNUAL PERCENT CHANGE, which is a
// constant proportional change per year, not a constant absolute one. So the
// fit is on ln(y), and the slope b converts to APC = (exp(b) - 1) * 100.
//
// The segmented model is the continuous piecewise-linear one used throughout
// the mortality literature:
//
//   ln(y) = b0 + b1*x + b2*(x - t1)+ + b3*(x - t2)+ ...        (u)+ = max(0, u)
//
// which stays linear in the coefficients, so each candidate set of joinpoint
// locations is an ordinary least-squares fit. With yearly data there are only a
// handful of interior years, so the locations are found by exhaustive search
// rather than by the grid-and-refine the NCI program uses.
//
// This is NOT the NCI Joinpoint Regression Program. It selects the number of
// joinpoints by BIC rather than by the permutation test that program runs, and
// it does not produce confidence intervals for the joinpoint locations. It is a
// reasonable description of where a trend bends; it is not a substitute for
// that software in a publication, and the UI says so.

export interface TrendPoint {
  x: number;
  y: number;
  label: string;
}

export interface TrendSegment {
  startX: number;
  endX: number;
  startLabel: string;
  endLabel: string;
  /** Slope on the log scale. */
  slope: number;
  /** Annual percent change: (exp(slope) - 1) * 100. */
  apc: number;
}

export interface TrendFit {
  segments: TrendSegment[];
  /** Joinpoint x positions, empty for a single straight trend. */
  joinpoints: number[];
  /** Fitted values at each input point, on the original scale. */
  fitted: { x: number; y: number }[];
  r2: number;
  bic: number;
  n: number;
  /**
   * Average annual percent change across the whole span, weighted by segment
   * length — the single number usually quoted alongside the segments.
   */
  aapc: number;
}

/** Solve a small symmetric normal-equation system by Gaussian elimination. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null; // singular: collinear basis
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  // After full elimination each row is [0 … pivot … 0 | rhs].
  return m.map((row, i) => row[n] / row[i]);
}

/** Least squares of y on the given design matrix. */
function ols(design: number[][], y: number[]): { coef: number[]; rss: number } | null {
  const k = design[0].length;
  const ata = Array.from({ length: k }, () => new Array(k).fill(0));
  const aty = new Array(k).fill(0);
  for (let i = 0; i < design.length; i++) {
    for (let p = 0; p < k; p++) {
      aty[p] += design[i][p] * y[i];
      for (let q = 0; q < k; q++) ata[p][q] += design[i][p] * design[i][q];
    }
  }
  const coef = solve(ata, aty);
  if (!coef) return null;
  let rss = 0;
  for (let i = 0; i < design.length; i++) {
    const pred = design[i].reduce((acc, v, p) => acc + v * coef[p], 0);
    rss += (y[i] - pred) ** 2;
  }
  return { coef, rss };
}

/** Design row for a continuous piecewise-linear model at the given knots. */
const designRow = (x: number, knots: number[]) => [
  1,
  x,
  ...knots.map((t) => Math.max(0, x - t)),
];

/** All ways to choose `count` knots from the interior points, respecting a minimum run. */
function knotCombinations(xs: number[], count: number, minRun: number): number[][] {
  if (count === 0) return [[]];
  const out: number[][] = [];
  // A knot sits on an observed x; the first and last minRun points cannot hold one.
  const candidates = xs.slice(minRun - 1, xs.length - minRun + 1);
  const walk = (start: number, chosen: number[]) => {
    if (chosen.length === count) {
      out.push([...chosen]);
      return;
    }
    for (let i = start; i < candidates.length; i++) {
      const t = candidates[i];
      // Keep segments apart by at least minRun observations.
      if (chosen.length) {
        const prev = chosen[chosen.length - 1];
        const between = xs.filter((v) => v > prev && v <= t).length;
        if (between < minRun) continue;
      }
      walk(i + 1, [...chosen, t]);
    }
  };
  walk(0, []);
  return out;
}

function buildFit(points: TrendPoint[], knots: number[]): TrendFit | null {
  const logY = points.map((p) => Math.log(p.y));
  const design = points.map((p) => designRow(p.x, knots));
  const fit = ols(design, logY);
  if (!fit) return null;

  const n = points.length;
  const mean = logY.reduce((a, b) => a + b, 0) / n;
  const tss = logY.reduce((a, v) => a + (v - mean) ** 2, 0);
  const r2 = tss > 0 ? 1 - fit.rss / tss : 0;
  // Two parameters per segment: the segment's own slope, and its knot (the
  // first segment's "knot" is the intercept). Charging for the knots is what
  // stops BIC preferring a joinpoint at every opportunity.
  const k = 2 * (knots.length + 1);
  const bic = n * Math.log(Math.max(fit.rss, 1e-12) / n) + k * Math.log(n);

  const bounds = [points[0].x, ...knots, points[n - 1].x];
  const segments: TrendSegment[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    // Cumulative slope: each basis term adds to the slope from its knot on.
    const slope = fit.coef.slice(1, 2 + i).reduce((a, b) => a + b, 0);
    const startX = bounds[i];
    const endX = bounds[i + 1];
    segments.push({
      startX,
      endX,
      startLabel: points.find((p) => p.x === startX)?.label ?? String(startX),
      endLabel: points.find((p) => p.x === endX)?.label ?? String(endX),
      slope,
      apc: (Math.exp(slope) - 1) * 100,
    });
  }

  const span = points[n - 1].x - points[0].x;
  const aapc =
    span > 0
      ? (Math.exp(
          segments.reduce((acc, sg) => acc + sg.slope * (sg.endX - sg.startX), 0) / span,
        ) -
          1) *
        100
      : segments[0]?.apc ?? 0;

  return {
    segments,
    joinpoints: knots,
    fitted: points.map((p) => ({
      x: p.x,
      y: Math.exp(designRow(p.x, knots).reduce((acc, v, i) => acc + v * fit.coef[i], 0)),
    })),
    r2,
    bic,
    n,
    aapc,
  };
}

/**
 * Fit a trend, optionally allowing the slope to change.
 *
 * @param maxJoinpoints 0 gives a single log-linear trend. Higher values let BIC
 *   choose, which it only does when the bend genuinely pays for its parameters.
 */
export function fitTrend(points: TrendPoint[], maxJoinpoints = 0): TrendFit | null {
  // ln(y) needs y > 0, and a zero here means "no deaths recorded", not "a rate
  // approaching zero" — dropping those is honest, and the caller says how many.
  const usable = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.y > 0)
    .sort((a, b) => a.x - b.x);
  if (usable.length < 3) return null;

  const xs = usable.map((p) => p.x);
  const minRun = 3; // a segment needs enough points for its slope to mean anything
  const maxJ = Math.max(0, Math.min(maxJoinpoints, Math.floor(usable.length / minRun) - 1));

  let best: TrendFit | null = null;
  for (let j = 0; j <= maxJ; j++) {
    for (const knots of knotCombinations(xs, j, minRun)) {
      const fit = buildFit(usable, knots);
      if (fit && (!best || fit.bic < best.bic)) best = fit;
    }
  }
  return best;
}

/** "1.8% per year" / "down 2.4% per year" */
export function describeApc(apc: number): string {
  const dir = apc >= 0 ? "up" : "down";
  return `${dir} ${Math.abs(apc).toFixed(1)}% per year`;
}
