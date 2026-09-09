// Direct age standardisation to the 2000 US standard population.
//
// The provisional file does not publish age-adjusted rates, which is a problem
// for a series that reaches the current year: age-adjusted is the right measure
// for a long trend, and without this the headline measure would stop several
// years short of the data.
//
// Direct standardisation asks what the death rate would be if the population
// had the age structure of a fixed reference — so two years, or two groups,
// can be compared without the answer being driven by one of them being older.
// The reference is the 2000 US standard, which is what NCHS and CDC WONDER use,
// so a rate computed here is on the same footing as one WONDER returns.
//
//   adjusted rate = sum over age groups of (deaths_i / population_i) * w_i
//
// The weights are the standard population's share in each age group.

/**
 * The 2000 US standard population, in the eleven age groups WONDER's ten-year
 * grouping uses. Published per 1,000,000; they sum to exactly that.
 */
const STANDARD_2000: { label: string; weight: number }[] = [
  { label: "< 1 year", weight: 13818 },
  { label: "1-4 years", weight: 55317 },
  { label: "5-14 years", weight: 145565 },
  { label: "15-24 years", weight: 138646 },
  { label: "25-34 years", weight: 135573 },
  { label: "35-44 years", weight: 162613 },
  { label: "45-54 years", weight: 134834 },
  { label: "55-64 years", weight: 87247 },
  { label: "65-74 years", weight: 66037 },
  { label: "75-84 years", weight: 44842 },
  { label: "85+ years", weight: 15508 },
];

const TOTAL_WEIGHT = STANDARD_2000.reduce((a, g) => a + g.weight, 0);

/** Normalise a WONDER age label so it matches the standard population's. */
function normaliseAgeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

const WEIGHT_BY_LABEL = new Map(
  STANDARD_2000.map((g) => [normaliseAgeLabel(g.label), g.weight]),
);

export interface AgeStratum {
  ageLabel: string;
  deaths: number;
  population: number;
}

export interface AdjustedRate {
  rate: number;
  /** Share of the standard population the supplied strata covered. */
  coverage: number;
  strataUsed: number;
}

/**
 * Age-adjusted rate from strata.
 *
 * An age group ABSENT from the strata is treated as having no deaths, not as
 * missing data. WONDER omits age groups with no records entirely, so a suicide
 * query returns nothing at all for under-5s — and rescaling by the age range
 * that did come back would inflate the rate by treating infants as though they
 * died at the same rate as everyone else. Where an absence is really CDC
 * suppression rather than a true zero this understates slightly, by at most the
 * nine deaths suppression hides, spread over that group's share of the standard
 * population.
 *
 * @returns null when the supplied strata cover too little of the standard
 *   population for the result to deserve the name. Missing the under-5s costs
 *   6.9% and is fine; missing the over-65s is not an age-adjusted rate at all.
 */
export function ageAdjustedRate(
  strata: AgeStratum[],
  per = 100000,
  minCoverage = 0.8,
): AdjustedRate | null {
  let weighted = 0;
  let covered = 0;
  let used = 0;

  for (const s of strata) {
    const weight = WEIGHT_BY_LABEL.get(normaliseAgeLabel(s.ageLabel));
    // "Not Stated" has no place in the standard population and is skipped;
    // it is also, deliberately, not counted towards coverage.
    if (weight === undefined) continue;
    if (!(s.population > 0)) continue;
    weighted += (s.deaths / s.population) * weight;
    covered += weight;
    used += 1;
  }

  if (covered / TOTAL_WEIGHT < minCoverage) return null;
  // Divided by the FULL standard weight, so an absent group contributes zero
  // rather than being scaled away.
  return {
    rate: (weighted / TOTAL_WEIGHT) * per,
    coverage: covered / TOTAL_WEIGHT,
    strataUsed: used,
  };
}

/** The age labels this standard recognises, for callers that need to check. */
export function standardAgeLabels(): string[] {
  return STANDARD_2000.map((g) => g.label);
}
