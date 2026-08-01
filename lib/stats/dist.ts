// Shared distribution helpers (p-values) used across the stats modules.
// Dependency-free implementations of logGamma, the regularized incomplete beta
// and gamma functions, and the t / F / chi-square tail probabilities.

export function logGamma(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let a = c[0];
  const t = z + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularized incomplete beta I_x(a, b). */
export function regIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // The continued fraction below only converges quickly for
  // x < (a+1)/(a+b+2); past that it stalls and returns a badly wrong value.
  // Use the symmetry I_x(a,b) = 1 - I_{1-x}(b,a) to stay in the good region.
  // Without this, t-tests on a near-zero slope (x -> 1) returned p ~ 0.01
  // instead of p ~ 1 — i.e. "significant" for a perfectly flat trend.
  if (x > (a + 1) / (a + b + 2)) return 1 - regIncompleteBeta(1 - x, b, a);
  const lbeta =
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lbeta) / a;
  let f = 1,
    c = 1,
    d = 0;
  for (let i = 0; i <= 300; i++) {
    const m = Math.floor(i / 2);
    let numerator: number;
    if (i === 0) numerator = 1;
    else if (i % 2 === 0)
      numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else numerator = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= c * d;
    if (Math.abs(1 - c * d) < 1e-10) break;
  }
  return Math.min(Math.max(front * (f - 1), 0), 1);
}

/** Regularized lower incomplete gamma P(s, x) — series expansion. */
function gammaSeries(s: number, x: number): number {
  let sum = 1 / s;
  let term = sum;
  for (let k = 1; k < 500; k++) {
    term *= x / (s + k);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-13) break;
  }
  return sum * Math.exp(-x + s * Math.log(x) - logGamma(s));
}

/** Regularized UPPER incomplete gamma Q(s, x) — continued fraction. */
function gammaContinuedFraction(s: number, x: number): number {
  let b = x + 1 - s;
  let c = 1e300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.exp(-x + s * Math.log(x) - logGamma(s)) * h;
}

/** Regularized lower incomplete gamma P(s, x). */
export function regIncompleteGammaLower(s: number, x: number): number {
  if (x <= 0) return 0;
  return x < s + 1 ? gammaSeries(s, x) : 1 - gammaContinuedFraction(s, x);
}

/**
 * Regularized UPPER incomplete gamma Q(s, x) = 1 - P(s, x), computed directly
 * rather than as `1 - P`. Q is what the chi-square p-value needs, and for large
 * x it is far smaller than machine epsilon relative to 1 — computing it by
 * subtraction collapses to exactly 0 (e.g. chi2=100, df=1 has p ~ 1.5e-23).
 */
export function regIncompleteGammaUpper(s: number, x: number): number {
  if (x <= 0) return 1;
  return x < s + 1 ? 1 - gammaSeries(s, x) : gammaContinuedFraction(s, x);
}

/** Two-sided p-value for Student's t with df degrees of freedom. */
export function studentTwoSidedP(t: number, df: number): number {
  if (df <= 0) return 1;
  const x = df / (df + t * t);
  return regIncompleteBeta(x, df / 2, 0.5);
}

/** Upper-tail p-value for the F distribution: P(F > f). */
export function fUpperP(f: number, d1: number, d2: number): number {
  if (f <= 0 || d1 <= 0 || d2 <= 0) return 1;
  const x = d2 / (d2 + d1 * f);
  return regIncompleteBeta(x, d2 / 2, d1 / 2);
}

/** Upper-tail p-value for chi-square with k degrees of freedom. */
export function chiSquareUpperP(chi2: number, k: number): number {
  if (chi2 <= 0 || k <= 0) return 1;
  return regIncompleteGammaUpper(k / 2, chi2 / 2);
}
