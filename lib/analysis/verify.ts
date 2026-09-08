// Numeric verification for AI-written analysis.
//
// The model is handed a fact sheet of exact figures and asked to narrate them.
// That is a much weaker guarantee than "the numbers are right", so every number
// it writes back is checked against what it was given before the text reaches
// the user. A sentence containing a figure we cannot account for is dropped,
// and the caller is told how many were dropped — silently publishing an
// unverifiable mortality statistic is the one failure mode worth engineering
// against.
//
// What counts as accountable:
//   - any number appearing in the fact sheet (at any sensible rounding),
//   - any ratio, difference or percent change between two key figures (the
//     model is explicitly allowed to compare two categories),
//   - small integers up to 20, which are counting words ("three of the six
//     age groups") rather than statistics.

// No sign: a leading "-" in this text is almost always a range hyphen
// ("2018-2024", "15-24 years"), and reading it as a minus turned 2024 into
// -2024, which then failed verification. Magnitude alone identifies a figure,
// and the allow set carries both signs of every derived value anyway.
const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;
const MAX_DECIMALS = 3;
const SMALL_INTEGER_LIMIT = 20;
/** Pairwise derivations are O(n^2); cap the inputs so this stays cheap. */
const MAX_KEY_FIGURES = 90;

export interface AllowSet {
  /** buckets[d] holds every allowed value rendered to d decimal places */
  buckets: Set<string>[];
}

/** Pull every numeric literal out of a block of text. */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function decimalsOf(literal: string): number {
  const dot = literal.indexOf(".");
  return dot === -1 ? 0 : Math.min(MAX_DECIMALS, literal.length - dot - 1);
}

function addValue(buckets: Set<string>[], v: number) {
  if (!Number.isFinite(v)) return;
  // Both signs: extraction is unsigned, so a fall of 17.2% has to match the
  // -17.2 the fact sheet actually printed.
  for (const x of [v, -v]) {
    for (let d = 0; d <= MAX_DECIMALS; d++) buckets[d].add(x.toFixed(d));
  }
}

/**
 * Build the set of numbers the model is allowed to write.
 *
 * @param factSheet the exact text the model was given (its numbers are ground truth)
 * @param keyFigures headline figures that the model may legitimately compare
 *                   against each other (totals, category values, rates)
 */
export function buildAllowSet(factSheet: string, keyFigures: number[]): AllowSet {
  const buckets: Set<string>[] = Array.from({ length: MAX_DECIMALS + 1 }, () => new Set<string>());

  for (const n of extractNumbers(factSheet)) addValue(buckets, n);
  for (let i = 0; i <= SMALL_INTEGER_LIMIT; i++) addValue(buckets, i);

  const keys = [...new Set(keyFigures.filter((n) => Number.isFinite(n)))].slice(0, MAX_KEY_FIGURES);
  for (const a of keys) {
    for (const b of keys) {
      if (a === b) continue;
      addValue(buckets, a - b);
      if (b !== 0) {
        addValue(buckets, a / b); // "2.3 times as many"
        addValue(buckets, ((a - b) / Math.abs(b)) * 100); // "up 14.7%"
        addValue(buckets, (a / b) * 100); // "accounts for 61.2%"
      }
    }
  }

  return { buckets };
}

/** Is this numeric literal accountable to the fact sheet? */
export function isVerified(literal: string, allow: AllowSet): boolean {
  const value = Number(literal.replace(/,/g, ""));
  if (!Number.isFinite(value)) return true; // not a number we can judge
  const d = decimalsOf(literal);
  return allow.buckets[d].has(value.toFixed(d));
}

export interface VerifyResult {
  kept: string[];
  dropped: { text: string; figures: string[] }[];
}

/**
 * Keep only the sentences whose every figure checks out. Verification is per
 * statement so one bad number costs one bullet, not the whole analysis.
 */
export function verifyStatements(statements: string[], allow: AllowSet): VerifyResult {
  const kept: string[] = [];
  const dropped: { text: string; figures: string[] }[] = [];

  for (const s of statements) {
    const bad: string[] = [];
    for (const m of s.matchAll(NUMBER_RE)) {
      if (!isVerified(m[0], allow)) bad.push(m[0]);
    }
    if (bad.length === 0) kept.push(s);
    else dropped.push({ text: s, figures: bad });
  }

  return { kept, dropped };
}
