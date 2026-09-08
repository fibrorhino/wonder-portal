// Deterministic "fact sheet" for a result table.
//
// This is the analytical core behind the talking points. Everything here is
// computed from the returned table with no model involved, so every figure is
// exact. Two consumers:
//   1. lib/insights.ts turns it into plain-English bullets (the no-AI path).
//   2. app/api/insights/route.ts renders it as text for the LLM, which narrates
//      it. The model is given numbers, never asked to derive them.
//
// The figures deliberately go past "biggest / smallest": marginal rates, shares,
// per-series trends, count-vs-rate divergence, and observed-vs-expected cell
// ratios are the things that make a table interesting, and none of them are
// visible by eye.

import type { QuerySpec, ResultTable } from "../wonder/types";
import {
  cellLabel,
  cellNumber,
  dataRows,
  dimensionCols,
  measureCols,
  numericEncode,
} from "../tableUtils";
import { trend, type TrendResult } from "../stats/summary";
import { describeFilters, describeGrouping } from "../describeSpec";
import { DATABASE_LABEL, VARIABLE_BY_KEY } from "../wonder/databases";

// ---------------------------------------------------------------------------
// Population is a denominator, not a count, and only some dimensions split it.
//
// Grouping by sex splits the population into male/female, so collapsing that
// dimension by summing populations is correct. Grouping by injury mechanism
// does NOT — every mechanism row repeats the same population, so summing over
// mechanisms would inflate the denominator by the number of mechanisms.
//
// Year is included: collapsing years sums person-years, which is exactly the
// denominator a multi-year crude rate needs (and what WONDER itself uses).
// Month is NOT — the population repeats for every month of a year.
// ---------------------------------------------------------------------------
const POPULATION_PARTITIONING = new Set([
  "year",
  "sex",
  "ageTen",
  "ageFive",
  "ageSingle",
  "race6",
  "race15",
  "race31",
  "hispanicOrigin",
]);

const TIME_KEYS = new Set(["year", "month"]);

export interface CategoryFact {
  label: string;
  deaths: number | null;
  population: number | null;
  rate: number | null; // crude, per `ratePer`, computed as deaths / population
  /**
   * WONDER's age-adjusted rate, taken straight from the response. Only present
   * when the category maps to exactly one row: an age-adjusted rate is a
   * weighted sum over a standard age distribution, so unlike deaths it cannot
   * be re-derived by adding rows together.
   */
  ageAdjustedRate: number | null;
  sharePct: number | null; // share of the table's total deaths
  suppressedCells: number;
}

export interface DimensionFacts {
  variableKey?: string;
  label: string;
  isTime: boolean;
  categoryCount: number;
  categories: CategoryFact[]; // sorted by deaths desc, capped
  ratesValid: boolean;
  topSharePct: number | null;
  top3SharePct: number | null;
  /** Highest and lowest crude rate among categories with a usable rate. */
  highestRate?: CategoryFact;
  lowestRate?: CategoryFact;
  rateRatio: number | null; // highest / lowest
  /**
   * The same comparison on age-adjusted rates, available only when every
   * category carries one. This is the honest basis for comparing groups with
   * different age structures, so prefer it when it exists.
   */
  highestAdjusted?: CategoryFact;
  lowestAdjusted?: CategoryFact;
  adjustedRatio: number | null;
  /** True when the largest count and the highest rate are different categories. */
  countRateDiverges: boolean;
}

export interface SeriesTrend {
  name: string;
  first: number;
  last: number;
  firstLabel: string;
  lastLabel: string;
  changePct: number;
}

export interface TimeFacts {
  label: string;
  variableKey: string;
  points: { label: string; deaths: number | null; rate: number | null }[];
  deathsTrend: TrendResult | null;
  rateTrend: TrendResult | null;
  peak?: { label: string; value: number };
  trough?: { label: string; value: number };
  largestStep?: { from: string; to: string; changePct: number };
  /** Per-category trends for the primary categorical dimension. */
  bySeries: SeriesTrend[];
  seriesDimLabel?: string;
}

export interface CellFact {
  rowLabel: string;
  colLabel: string;
  observed: number;
  expected: number;
  ratio: number; // observed / expected under independence
}

export interface InteractionFacts {
  rowDimLabel: string;
  colDimLabel: string;
  overRepresented: CellFact[];
  underRepresented: CellFact[];
}

export interface FactSheet {
  database: string;
  grouping: string;
  filters: string;
  measures: string[];
  ratePer: number;
  rowCount: number;
  totals: {
    deaths: number | null;
    population: number | null;
    rate: number | null;
    populationValid: boolean;
  };
  dimensions: DimensionFacts[];
  time?: TimeFacts;
  interaction?: InteractionFacts;
  dataQuality: {
    suppressedCells: number;
    unreliableCells: number;
    zeroRows: number;
    totalRows: number;
  };
  caveats: string[];
  /** Compact rendering of the underlying rows, for context. */
  sample: { header: string[]; rows: string[][]; truncated: number };
}

const MAX_CATEGORIES = 14;
const MAX_SERIES = 6;
const MAX_CELLS = 4;
const MAX_SAMPLE_ROWS = 120;

function sum(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

function rateOf(deaths: number | null, population: number | null, per: number): number | null {
  if (deaths === null || population === null || population <= 0) return null;
  return (deaths / population) * per;
}

export function buildFactSheet(table: ResultTable, spec?: QuerySpec): FactSheet {
  const rows = dataRows(table);
  const dims = dimensionCols(table);
  const measures = measureCols(table);
  const per = spec?.options?.ratePer ?? 100000;

  const idx = (key: string) =>
    measures.find((m) => m.column.measureKey === key)?.index ?? null;
  const deathsIdx = idx("deaths");
  const popIdx = idx("population");
  const crudeIdx = idx("crudeRate");
  const aarIdx = idx("ageAdjustedRate");

  const dimKeys = dims.map((d) => d.column.variableKey ?? "");
  const allDimsPartitionPopulation = dimKeys.every((k) => POPULATION_PARTITIONING.has(k));

  // ---- totals -------------------------------------------------------------
  const totalDeaths = deathsIdx === null ? null : sum(rows.map((r) => cellNumber(r[deathsIdx])));
  const totalPop =
    popIdx !== null && allDimsPartitionPopulation
      ? sum(rows.map((r) => cellNumber(r[popIdx])))
      : null;

  // ---- per-dimension marginals -------------------------------------------
  const dimensions: DimensionFacts[] = dims.map((d) => {
    const key = d.column.variableKey;
    const isTime = TIME_KEYS.has(key ?? "");
    // Collapsing every OTHER dimension is what forms this marginal, so the
    // population sum is only meaningful when those others split the population.
    const othersPartition = dims
      .filter((o) => o.index !== d.index)
      .every((o) => POPULATION_PARTITIONING.has(o.column.variableKey ?? ""));
    const ratesValid = popIdx !== null && othersPartition;

    const buckets = new Map<
      string,
      {
        deaths: (number | null)[];
        pop: (number | null)[];
        suppressed: number;
        rate: number | null;
        aar: number | null;
        rows: number;
      }
    >();
    for (const r of rows) {
      const label = cellLabel(r[d.index]);
      let b = buckets.get(label);
      if (!b) {
        b = { deaths: [], pop: [], suppressed: 0, rate: null, aar: null, rows: 0 };
        buckets.set(label, b);
      }
      b.rows += 1;
      if (aarIdx !== null) b.aar = cellNumber(r[aarIdx]);
      if (deathsIdx !== null) {
        b.deaths.push(cellNumber(r[deathsIdx]));
        if (r[deathsIdx]?.flag === "suppressed") b.suppressed += 1;
      }
      if (popIdx !== null) b.pop.push(cellNumber(r[popIdx]));
      // Single-dimension tables: each row IS a category, so WONDER's own rate
      // column can be used directly when we cannot rebuild one.
      if (dims.length === 1) {
        const rIdx = crudeIdx ?? aarIdx;
        if (rIdx !== null) b.rate = cellNumber(r[rIdx]);
      }
    }

    const cats: CategoryFact[] = [...buckets.entries()].map(([label, b]) => {
      const deaths = sum(b.deaths);
      const population = ratesValid ? sum(b.pop) : null;
      const rate = ratesValid ? rateOf(deaths, population, per) : b.rate;
      return {
        label,
        deaths,
        population,
        rate,
        // One row per category, or the age-adjusted rate is not attributable.
        ageAdjustedRate: b.rows === 1 ? b.aar : null,
        sharePct:
          deaths !== null && totalDeaths !== null && totalDeaths > 0
            ? (deaths / totalDeaths) * 100
            : null,
        suppressedCells: b.suppressed,
      };
    });

    const byDeaths = [...cats].sort((a, b) => (b.deaths ?? -1) - (a.deaths ?? -1));
    const withRate = cats.filter((c) => c.rate !== null && Number.isFinite(c.rate));
    const byRate = [...withRate].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
    const highestRate = byRate[0];
    const lowestRate = byRate.length > 1 ? byRate[byRate.length - 1] : undefined;

    const top3 = byDeaths.slice(0, 3).map((c) => c.sharePct ?? 0).reduce((a, b) => a + b, 0);

    // Age-adjusted comparison only when every category has one, so the
    // highest/lowest pair is drawn from the same measure throughout.
    const adjusted = cats.filter(
      (c) => c.ageAdjustedRate !== null && Number.isFinite(c.ageAdjustedRate),
    );
    const byAdjusted =
      adjusted.length === cats.length && adjusted.length > 1
        ? [...adjusted].sort((a, b) => (b.ageAdjustedRate ?? 0) - (a.ageAdjustedRate ?? 0))
        : [];
    const highestAdjusted = byAdjusted[0];
    const lowestAdjusted = byAdjusted[byAdjusted.length - 1];

    return {
      variableKey: key,
      label: d.column.label,
      isTime,
      categoryCount: cats.length,
      // Time dimensions read better in chronological order.
      categories: (isTime
        ? [...cats].sort(
            (a, b) =>
              (numericEncode(key, a.label) ?? 0) - (numericEncode(key, b.label) ?? 0),
          )
        : byDeaths
      ).slice(0, MAX_CATEGORIES),
      ratesValid: ratesValid || dims.length === 1,
      topSharePct: byDeaths[0]?.sharePct ?? null,
      top3SharePct: cats.length > 3 ? top3 : null,
      highestRate,
      lowestRate,
      rateRatio:
        highestRate && lowestRate && lowestRate.rate && lowestRate.rate > 0
          ? (highestRate.rate as number) / lowestRate.rate
          : null,
      highestAdjusted,
      lowestAdjusted,
      adjustedRatio:
        highestAdjusted &&
        lowestAdjusted &&
        lowestAdjusted.ageAdjustedRate &&
        lowestAdjusted.ageAdjustedRate > 0
          ? (highestAdjusted.ageAdjustedRate as number) / lowestAdjusted.ageAdjustedRate
          : null,
      countRateDiverges: Boolean(
        highestRate && byDeaths[0] && highestRate.label !== byDeaths[0].label,
      ),
    };
  });

  // ---- time facts ---------------------------------------------------------
  const timeDim = dims.find((d) => TIME_KEYS.has(d.column.variableKey ?? ""));
  let time: TimeFacts | undefined;
  if (timeDim && deathsIdx !== null) {
    const key = timeDim.column.variableKey as string;
    const othersPartition = dims
      .filter((o) => o.index !== timeDim.index)
      .every((o) => POPULATION_PARTITIONING.has(o.column.variableKey ?? ""));
    const canRate = popIdx !== null && othersPartition;

    const byT = new Map<string, { d: (number | null)[]; p: (number | null)[] }>();
    for (const r of rows) {
      const label = cellLabel(r[timeDim.index]);
      let b = byT.get(label);
      if (!b) {
        b = { d: [], p: [] };
        byT.set(label, b);
      }
      b.d.push(cellNumber(r[deathsIdx]));
      if (popIdx !== null) b.p.push(cellNumber(r[popIdx]));
    }
    const points = [...byT.entries()]
      .map(([label, b]) => ({
        label,
        deaths: sum(b.d),
        rate: canRate ? rateOf(sum(b.d), sum(b.p), per) : null,
        ord: numericEncode(key, label) ?? 0,
      }))
      .sort((a, b) => a.ord - b.ord);

    const deathPts = points
      .filter((p) => p.deaths !== null)
      .map((p) => ({ label: p.label, value: p.deaths as number }));
    const ratePts = points
      .filter((p) => p.rate !== null)
      .map((p) => ({ label: p.label, value: p.rate as number }));

    // Biggest single period-over-period move — often the actual story.
    let largestStep: TimeFacts["largestStep"];
    for (let i = 1; i < deathPts.length; i++) {
      const prev = deathPts[i - 1];
      const cur = deathPts[i];
      if (prev.value <= 0) continue;
      const changePct = ((cur.value - prev.value) / prev.value) * 100;
      if (!largestStep || Math.abs(changePct) > Math.abs(largestStep.changePct)) {
        largestStep = { from: prev.label, to: cur.label, changePct };
      }
    }

    // Per-category trends over the primary categorical dimension.
    const catDim = dims.find((d) => !TIME_KEYS.has(d.column.variableKey ?? ""));
    const bySeries: SeriesTrend[] = [];
    if (catDim) {
      const seriesTotals = new Map<string, number>();
      const seriesPoints = new Map<string, Map<string, number>>();
      for (const r of rows) {
        const name = cellLabel(r[catDim.index]);
        const t = cellLabel(r[timeDim.index]);
        const v = cellNumber(r[deathsIdx]);
        if (v === null) continue;
        seriesTotals.set(name, (seriesTotals.get(name) ?? 0) + v);
        let m = seriesPoints.get(name);
        if (!m) {
          m = new Map();
          seriesPoints.set(name, m);
        }
        m.set(t, (m.get(t) ?? 0) + v);
      }
      const topNames = [...seriesTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_SERIES)
        .map(([n]) => n);
      for (const name of topNames) {
        const m = seriesPoints.get(name);
        if (!m) continue;
        const pts = [...m.entries()]
          .map(([label, value]) => ({ label, value, ord: numericEncode(key, label) ?? 0 }))
          .sort((a, b) => a.ord - b.ord);
        const tr = trend(pts);
        if (tr && Number.isFinite(tr.totalChangePct)) {
          bySeries.push({
            name,
            first: tr.first,
            last: tr.last,
            firstLabel: tr.firstLabel,
            lastLabel: tr.lastLabel,
            changePct: tr.totalChangePct,
          });
        }
      }
    }

    time = {
      label: timeDim.column.label,
      variableKey: key,
      points: points.map((p) => ({ label: p.label, deaths: p.deaths, rate: p.rate })),
      deathsTrend: trend(deathPts),
      rateTrend: ratePts.length > 1 ? trend(ratePts) : null,
      peak: deathPts.length ? deathPts.reduce((a, b) => (b.value > a.value ? b : a)) : undefined,
      trough: deathPts.length ? deathPts.reduce((a, b) => (b.value < a.value ? b : a)) : undefined,
      largestStep,
      bySeries,
      seriesDimLabel: catDim?.column.label,
    };
  }

  // ---- interaction (observed vs expected) ---------------------------------
  const interaction = buildInteraction(table, dims, deathsIdx);

  // ---- data quality -------------------------------------------------------
  const primaryIdx = deathsIdx ?? measures[0]?.index ?? null;
  let suppressedCells = 0;
  let unreliableCells = 0;
  let zeroRows = 0;
  for (const r of rows) {
    for (const m of measures) {
      if (r[m.index]?.flag === "suppressed") suppressedCells += 1;
      if (r[m.index]?.flag === "unreliable") unreliableCells += 1;
    }
    if (primaryIdx !== null && cellNumber(r[primaryIdx]) === 0) zeroRows += 1;
  }

  // ---- compact sample of the actual rows ----------------------------------
  const header = table.columns.map((c) => c.label);
  const sampleRows = rows
    .slice(0, MAX_SAMPLE_ROWS)
    .map((r) => table.columns.map((_, i) => (r[i] ? cellLabel(r[i]) || r[i].raw : "")));

  return {
    database: DATABASE_LABEL,
    grouping: spec ? describeGrouping(spec) : dims.map((d) => d.column.label).join(", "),
    filters: spec ? describeFilters(spec) : "(unknown)",
    measures: measures.map((m) => m.column.label),
    ratePer: per,
    rowCount: rows.length,
    totals: {
      deaths: totalDeaths,
      population: totalPop,
      rate: rateOf(totalDeaths, totalPop, per),
      populationValid: allDimsPartitionPopulation && popIdx !== null,
    },
    dimensions,
    time,
    interaction,
    dataQuality: {
      suppressedCells,
      unreliableCells,
      zeroRows,
      totalRows: rows.length,
    },
    caveats: table.caveats ?? [],
    sample: {
      header,
      rows: sampleRows,
      truncated: Math.max(0, rows.length - sampleRows.length),
    },
  };
}

/**
 * Observed-vs-expected for the first two dimensions. Under independence a cell
 * holds rowTotal * colTotal / grandTotal deaths; the ratio of what is actually
 * there to that expectation is what makes a cross-tab interesting (e.g. a
 * method that is far more concentrated in one group than the margins predict).
 */
function buildInteraction(
  table: ResultTable,
  dims: ReturnType<typeof dimensionCols>,
  deathsIdx: number | null,
): InteractionFacts | undefined {
  if (dims.length < 2 || deathsIdx === null) return undefined;
  const rows = dataRows(table);
  // Only compare two categorical dimensions. A time x category cross-tab's
  // "expected" value just restates "this category held a constant share", which
  // the per-series trend section already says far more clearly.
  const categorical = dims.filter((d) => !TIME_KEYS.has(d.column.variableKey ?? ""));
  if (categorical.length < 2) return undefined;
  const [rd, cd] = categorical;

  // Category labels contain spaces and punctuation, so the cell map carries the
  // label pair alongside the count rather than recovering it by splitting a
  // composite key.
  const rowLabels = new Set<string>();
  const colLabels = new Set<string>();
  const cells = new Map<string, { a: string; b: string; v: number }>();
  for (const r of rows) {
    const a = cellLabel(r[rd.index]);
    const b = cellLabel(r[cd.index]);
    const v = cellNumber(r[deathsIdx]);
    if (v === null) continue;
    rowLabels.add(a);
    colLabels.add(b);
    const k = `${JSON.stringify(a)}:${JSON.stringify(b)}`;
    const cur = cells.get(k);
    if (cur) cur.v += v;
    else cells.set(k, { a, b, v });
  }
  if (rowLabels.size < 2 || colLabels.size < 2) return undefined;

  const rowTot = new Map<string, number>();
  const colTot = new Map<string, number>();
  let grand = 0;
  for (const { a, b, v } of cells.values()) {
    rowTot.set(a, (rowTot.get(a) ?? 0) + v);
    colTot.set(b, (colTot.get(b) ?? 0) + v);
    grand += v;
  }
  if (grand <= 0) return undefined;

  const facts: CellFact[] = [];
  for (const { a, b, v: observed } of cells.values()) {
    const expected = ((rowTot.get(a) ?? 0) * (colTot.get(b) ?? 0)) / grand;
    // Tiny expected counts produce wild ratios that mean nothing; require the
    // cell to be substantial enough that the comparison is worth stating.
    if (expected < 50 || observed < 50) continue;
    facts.push({ rowLabel: a, colLabel: b, observed, expected, ratio: observed / expected });
  }
  if (facts.length === 0) return undefined;

  const over = [...facts].sort((a, b) => b.ratio - a.ratio).slice(0, MAX_CELLS);
  const under = [...facts].sort((a, b) => a.ratio - b.ratio).slice(0, MAX_CELLS);
  return {
    rowDimLabel: rd.column.label,
    colDimLabel: cd.column.label,
    // Only deviations big enough to be worth a sentence.
    overRepresented: over.filter((f) => f.ratio >= 1.35),
    underRepresented: under.filter((f) => f.ratio <= 0.7),
  };
}

// ---------------------------------------------------------------------------
// Rendering the fact sheet as text for the model.
// ---------------------------------------------------------------------------

export function fmt(n: number | null | undefined, d = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "n/a";
  // Fixed decimals, not "up to d": a rate that happens to be 6.0 read as a
  // bare "6" next to "23.3", which looks like a different kind of number.
  return n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
}

const pct = (n: number | null | undefined, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? "n/a" : `${fmt(n, d)}%`);

export function renderFactSheet(f: FactSheet): string {
  const L: string[] = [];
  L.push(`DATASET: ${f.database}`);
  L.push(`GROUPED BY: ${f.grouping || "(none)"}`);
  L.push(`FILTERS: ${f.filters}`);
  L.push(`MEASURES SHOWN: ${f.measures.join(", ")}`);
  L.push(`DATA ROWS: ${f.rowCount}`);
  L.push("");

  L.push("TOTALS");
  L.push(`- Total deaths across all rows shown: ${fmt(f.totals.deaths)}`);
  if (f.totals.population !== null) {
    L.push(`- Total population (person-years) covered: ${fmt(f.totals.population)}`);
  }
  if (f.totals.rate !== null) {
    L.push(`- Overall crude rate: ${fmt(f.totals.rate, 2)} per ${fmt(f.ratePer)}`);
  }
  L.push("");

  for (const d of f.dimensions) {
    L.push(`BREAKDOWN BY ${d.label.toUpperCase()} (${d.categoryCount} categories)`);
    for (const c of d.categories) {
      const bits = [`deaths ${fmt(c.deaths)}`];
      if (c.sharePct !== null) bits.push(`${pct(c.sharePct)} of total`);
      if (c.rate !== null) bits.push(`crude rate ${fmt(c.rate, 2)} per ${fmt(f.ratePer)}`);
      if (c.ageAdjustedRate !== null)
        bits.push(`age-adjusted rate ${fmt(c.ageAdjustedRate, 2)}`);
      if (c.population !== null) bits.push(`population ${fmt(c.population)}`);
      L.push(`- ${c.label}: ${bits.join("; ")}`);
    }
    if (d.categoryCount > d.categories.length) {
      L.push(`- (${d.categoryCount - d.categories.length} further categories not listed)`);
    }
    if (d.topSharePct !== null && !d.isTime) {
      L.push(`- Largest category holds ${pct(d.topSharePct)} of the deaths shown.`);
    }
    if (d.top3SharePct !== null && !d.isTime) {
      L.push(`- Top three categories combined: ${pct(d.top3SharePct)} of the deaths shown.`);
    }
    if (d.highestRate?.rate != null && d.lowestRate?.rate != null) {
      L.push(
        `- Highest rate: ${d.highestRate.label} at ${fmt(d.highestRate.rate, 2)}; lowest: ${d.lowestRate.label} at ${fmt(d.lowestRate.rate, 2)}` +
          (d.rateRatio ? `; ratio ${fmt(d.rateRatio, 2)}x` : ""),
      );
    }
    if (d.highestAdjusted?.ageAdjustedRate != null && d.lowestAdjusted?.ageAdjustedRate != null) {
      L.push(
        `- AGE-ADJUSTED (use this to compare groups, not the crude rate): highest ${d.highestAdjusted.label} at ${fmt(d.highestAdjusted.ageAdjustedRate, 2)}; lowest ${d.lowestAdjusted.label} at ${fmt(d.lowestAdjusted.ageAdjustedRate, 2)}` +
          (d.adjustedRatio ? `; ratio ${fmt(d.adjustedRatio, 2)}x` : ""),
      );
    }
    if (d.countRateDiverges && d.highestRate) {
      L.push(
        `- NOTE: the category with the most deaths is not the one with the highest rate (${d.highestRate.label} has the highest rate).`,
      );
    }
    L.push("");
  }

  if (f.time) {
    const t = f.time;
    L.push(`TREND OVER ${t.label.toUpperCase()}`);
    for (const p of t.points) {
      const bits = [`deaths ${fmt(p.deaths)}`];
      if (p.rate !== null) bits.push(`rate ${fmt(p.rate, 2)}`);
      L.push(`- ${p.label}: ${bits.join("; ")}`);
    }
    if (t.deathsTrend && Number.isFinite(t.deathsTrend.totalChangePct)) {
      const tr = t.deathsTrend;
      L.push(
        `- Deaths changed ${pct(tr.totalChangePct)} overall, from ${fmt(tr.first)} in ${tr.firstLabel} to ${fmt(tr.last)} in ${tr.lastLabel}` +
          (Number.isFinite(tr.cagrPct) ? ` (${pct(tr.cagrPct, 2)} per period compounded)` : ""),
      );
    }
    if (t.rateTrend && Number.isFinite(t.rateTrend.totalChangePct)) {
      const tr = t.rateTrend;
      L.push(
        `- Crude rate changed ${pct(tr.totalChangePct)} overall, from ${fmt(tr.first, 2)} in ${tr.firstLabel} to ${fmt(tr.last, 2)} in ${tr.lastLabel}.`,
      );
    }
    if (t.peak) L.push(`- Peak: ${t.peak.label} at ${fmt(t.peak.value)} deaths.`);
    if (t.trough) L.push(`- Lowest: ${t.trough.label} at ${fmt(t.trough.value)} deaths.`);
    if (t.largestStep) {
      L.push(
        `- Largest single-period move: ${t.largestStep.from} to ${t.largestStep.to}, ${pct(t.largestStep.changePct)}.`,
      );
    }
    if (t.bySeries.length) {
      L.push(`- Change by ${t.seriesDimLabel ?? "category"} (first to last period):`);
      for (const s of t.bySeries) {
        L.push(
          `  - ${s.name}: ${fmt(s.first)} in ${s.firstLabel} to ${fmt(s.last)} in ${s.lastLabel}, ${pct(s.changePct)}`,
        );
      }
    }
    L.push("");
  }

  if (f.interaction && (f.interaction.overRepresented.length || f.interaction.underRepresented.length)) {
    const i = f.interaction;
    L.push(
      `CONCENTRATION: ${i.rowDimLabel} x ${i.colDimLabel}, actual deaths vs the number expected if the two were unrelated`,
    );
    for (const c of i.overRepresented) {
      L.push(
        `- ${c.rowLabel} / ${c.colLabel}: ${fmt(c.observed)} observed vs ${fmt(c.expected)} expected (${fmt(c.ratio, 2)}x more than expected)`,
      );
    }
    for (const c of i.underRepresented) {
      L.push(
        `- ${c.rowLabel} / ${c.colLabel}: ${fmt(c.observed)} observed vs ${fmt(c.expected)} expected (${fmt(c.ratio, 2)}x, i.e. fewer than expected)`,
      );
    }
    L.push("");
  }

  const q = f.dataQuality;
  if (q.suppressedCells || q.unreliableCells || q.zeroRows) {
    L.push("DATA QUALITY");
    if (q.suppressedCells)
      L.push(
        `- ${q.suppressedCells} cell(s) suppressed by CDC (counts of 1-9); those deaths are NOT in the totals above.`,
      );
    if (q.unreliableCells)
      L.push(`- ${q.unreliableCells} rate(s) flagged unreliable (based on fewer than 20 deaths).`);
    if (q.zeroRows) L.push(`- ${q.zeroRows} row(s) had zero deaths.`);
    L.push("");
  }

  L.push(`DATA TABLE (${f.sample.rows.length} of ${f.rowCount} rows)`);
  L.push(f.sample.header.join(" | "));
  for (const r of f.sample.rows) L.push(r.join(" | "));
  if (f.sample.truncated) L.push(`(${f.sample.truncated} further rows omitted)`);

  return L.join("\n");
}

/** Variable label lookup used by callers that only hold a key. */
export function labelForKey(key: string): string {
  return VARIABLE_BY_KEY[key]?.label ?? key;
}

/**
 * Headline figures the model may legitimately compare with each other
 * (see lib/analysis/verify.ts). Totals, category counts/rates and the time
 * series — the numbers a sentence like "twice as many as" would be built from.
 */
export function keyFigures(f: FactSheet): number[] {
  const out: number[] = [];
  const push = (n: number | null | undefined) => {
    if (n !== null && n !== undefined && Number.isFinite(n)) out.push(n);
  };
  push(f.totals.deaths);
  push(f.totals.population);
  push(f.totals.rate);
  for (const d of f.dimensions) {
    for (const c of d.categories) {
      push(c.deaths);
      push(c.rate);
      push(c.ageAdjustedRate);
      push(c.sharePct);
    }
  }
  if (f.time) {
    for (const p of f.time.points) {
      push(p.deaths);
      push(p.rate);
    }
  }
  if (f.interaction) {
    for (const c of [...f.interaction.overRepresented, ...f.interaction.underRepresented]) {
      push(c.observed);
      push(c.expected);
    }
  }
  return out;
}
