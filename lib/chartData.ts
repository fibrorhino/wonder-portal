// Turning a result table into the values a chart or a statistic can use.
//
// A table can have up to five grouping variables. A chart shows two of them (x
// and the series), and a regression uses one. Every other variable has to be
// dealt with explicitly: either the reader picks one value of it, or it is
// combined. Before this module existed nothing dealt with it at all, and the
// rows were simply plotted. A query grouped by year, sex and race drew each
// sex as a line that jumped between all seven race groups within every year,
// and the stats tab regressed men's and women's counts as if they were one
// series, then reported "not statistically significant" for two series that
// are each rising.
//
// Combining is not always possible, and when it is not the reason is returned
// instead of a number:
//   - Deaths add up.
//   - Population adds up only across variables that split the population
//     (sex, age, race, year); grouping by cause repeats the same population on
//     every row, so it is taken once, not added.
//   - A crude rate is rebuilt from the combined deaths and population, which
//     is what a combined crude rate is. It is never an average of rates.
//   - An age-adjusted rate cannot be combined at all: it is standardised
//     within each group, and the groups' rates do not add or average into the
//     rate of the whole.

import type { MeasureKey, ResultCell, ResultTable } from "./wonder/types";
import { cellLabel, cellNumber, dataRows, dimensionCols } from "./tableUtils";
import { POPULATION_PARTITIONING } from "./analysis/facts";

/** Column index of a dimension -> the one value of it to keep. */
export type Within = Record<number, string>;

export type CollapseResult =
  | {
      ok: true;
      /** Rows the same width as the table. Only the kept dimensions and the measure are meaningful. */
      rows: ResultCell[][];
      /** Dimensions that were combined, by column index. */
      collapsed: number[];
    }
  | {
      ok: false;
      /** Why, in a sentence. The caller adds what to do about it. */
      reason: string;
      collapsed: number[];
      /** Labels of the combined variables, for the caller's instruction. */
      names: string[];
    };

/** Measures whose values can be added together. */
export const isAdditiveMeasure = (key?: MeasureKey) => key === "deaths" || key === "population";

const ALL: ResultCell = { value: "All", raw: "All" };

/**
 * One row per combination of the kept dimensions, holding the measure.
 *
 * @param keep       column indices of the dimensions to keep, in order
 * @param measureIdx column index of the measure wanted
 * @param within     dimensions restricted to a single value; ignored for kept ones
 * @param ratePer    rate denominator, for rebuilding a crude rate
 */
export function collapseRows(
  table: ResultTable,
  keep: number[],
  measureIdx: number,
  within: Within = {},
  ratePer = 100000,
): CollapseResult {
  const dims = dimensionCols(table);
  const kept = new Set(keep);
  const restricted = dims.filter((d) => !kept.has(d.index) && within[d.index] !== undefined);
  const collapsed = dims.filter((d) => !kept.has(d.index) && within[d.index] === undefined);
  const collapsedIdx = collapsed.map((d) => d.index);

  const rows = dataRows(table).filter((r) =>
    restricted.every((d) => cellLabel(r[d.index]) === within[d.index]),
  );
  if (collapsed.length === 0) return { ok: true, rows, collapsed: [] };

  const column = table.columns[measureIdx];
  const measure = column?.measureKey;
  const names = collapsed.map((d) => d.column.label);
  const across = names.join(" and ");
  const refuse = (reason: string): CollapseResult => ({ ok: false, reason, collapsed: collapsedIdx, names });

  if (measure === "ageAdjustedRate") {
    return refuse(
      `Age-adjusted rates cannot be combined across ${across}: each group is standardised separately, and the groups' rates do not add up to the rate of the whole.`,
    );
  }

  const colOf = (key: MeasureKey) => table.columns.findIndex((c) => c.measureKey === key);
  const deathsIdx = colOf("deaths");
  const popIdx = colOf("population");
  const partitioning = collapsed.map((d) => POPULATION_PARTITIONING.has(d.column.variableKey ?? ""));

  if (measure === "crudeRate" && (deathsIdx < 0 || popIdx < 0)) {
    return refuse(`Crude rates cannot be combined across ${across} without the Deaths and Population columns.`);
  }
  if (
    (measure === "crudeRate" || measure === "population") &&
    !partitioning.every(Boolean) &&
    !partitioning.every((p) => !p)
  ) {
    return refuse(
      `${column.label} cannot be combined across ${across} together: some of them divide the population and some do not.`,
    );
  }
  if (measure !== "deaths" && measure !== "population" && measure !== "crudeRate") {
    return refuse(`${column?.label ?? "This measure"} cannot be combined across ${across}.`);
  }

  // Population for a group: added across variables that split it; taken once
  // across variables that repeat it.
  const populationOf = (group: ResultCell[][]): number | null => {
    const values = group.map((r) => cellNumber(r[popIdx]));
    if (partitioning.every(Boolean)) return sumOf(values);
    const present = values.filter((v): v is number => v !== null);
    if (present.length === 0) return null;
    // Repeated by construction; if they differ the table is not what this
    // assumes, and no number is better than a wrong one.
    return present.every((v) => v === present[0]) ? present[0] : null;
  };

  const groups = new Map<string, ResultCell[][]>();
  for (const r of rows) {
    const key = keep.map((i) => cellLabel(r[i])).join("\u0000");
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const out: ResultCell[][] = [];
  for (const group of groups.values()) {
    const row = group[0].map((cell, i) => (collapsedIdx.includes(i) ? ALL : cell));
    let value: number | null;
    if (measure === "deaths") value = sumOf(group.map((r) => cellNumber(r[measureIdx])));
    else if (measure === "population") value = populationOf(group);
    else {
      const deaths = sumOf(group.map((r) => cellNumber(r[deathsIdx])));
      const population = populationOf(group);
      value = deaths !== null && population !== null && population > 0 ? (deaths / population) * ratePer : null;
    }
    // A combined value has no confidence interval: CDC's are per row.
    row[measureIdx] = value === null ? { value: null, raw: "" } : { value, raw: String(value) };
    out.push(row);
  }
  return { ok: true, rows: out, collapsed: collapsedIdx };
}

function sumOf(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

/**
 * "Jan., 2018" -> "Jan"; "Feb., 2026 (provisional and partial)" -> "Feb".
 *
 * CDC labels months with their year. When the chart also shows the year, as an
 * axis or as one line per year, the year in the month label makes every month
 * of every year a category of its own: the seasonality example drew 84
 * one-point series. With the year carried by the other variable, the month
 * label only needs the month.
 */
export function monthOfYear(label: string): string {
  const name = label.replace(/,\s*\d{4}.*$/, "").trim();
  // One spelling per month. The files disagree ("May, 2022" in the final file,
  // "May., 2026" in the provisional one), and the combined series mixes them,
  // which made May two different categories.
  const i = MONTHS.findIndex((m) => name.toLowerCase().startsWith(m.toLowerCase()));
  return i >= 0 ? MONTHS[i] : name;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
