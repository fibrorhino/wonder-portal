// Rule-based "talking points" for a ResultTable — no AI required.
//
// Everything comes from the deterministic fact sheet (lib/analysis/facts.ts),
// so every figure is exact. This is what the panel shows before (and instead
// of) an AI analysis: totals, the shape of the leading categories, rate-based
// disparities, the time trend, per-series movement, concentration relative to
// what independence would predict, and data-quality caveats.

import type { QuerySpec, ResultTable } from "./wonder/types";
import { buildFactSheet, fmt, type CategoryFact, type FactSheet } from "./analysis/facts";
import { formatRatio } from "./stats/rates";
import { describeSeasonality } from "./stats/seasonality";

const pct = (n: number | null | undefined, d = 1) =>
  n === null || n === undefined || !Number.isFinite(n) ? "" : `${fmt(n, d)}%`;

// A respectful subject noun for describing a category of a given dimension,
// e.g. race -> "population", age -> "age group". Keeps the phrasing human and
// avoids blunt constructions on sensitive mortality data.
function subjectNoun(variableKey: string | undefined): string {
  switch (variableKey) {
    case "race6":
    case "race15":
    case "race31":
    case "hispanicOrigin":
      return "population";
    case "ageTen":
    case "ageFive":
    case "ageSingle":
      return "age group";
    case "sex":
    case "education":
      return "group";
    case "year":
    case "month":
      return "period";
    default:
      return "category";
  }
}

// "White" + population -> "White population"; a bare value gets quoted.
function subjectPhrase(value: string, variableKey: string | undefined): string {
  const noun = subjectNoun(variableKey);
  if (noun === "category") return `“${value}” category`;
  return `${value} ${noun}`;
}

const rateText = (c: CategoryFact, per: number) =>
  c.rate === null ? "" : ` (${fmt(c.rate, 1)} per ${fmt(per)})`;

/** Talking points computed straight from the table. */
export function talkingPoints(table: ResultTable, spec?: QuerySpec): string[] {
  return pointsFromFacts(buildFactSheet(table, spec));
}

export function pointsFromFacts(f: FactSheet): string[] {
  if (f.rowCount === 0) return ["No records matched this query."];

  const points: string[] = [];
  const caveatsProvisional: string[] = [];
  const per = f.ratePer;

  // ---- scale ----
  //
  // Suppressed cells parse to null and drop out of the sum, so a plain total
  // understates the truth — and when every cell is suppressed it once reported
  // "a total of 0 deaths" for data that is merely hidden. These bullets get
  // exported onto slides, so the total is qualified whenever anything was
  // suppressed and omitted entirely when nothing is left to count. The rate is
  // dropped in that case too: its numerator is the same undercount.
  const suppressed = f.dataQuality.suppressedCells;
  const rowsLabel = `${fmt(f.rowCount)} row${f.rowCount === 1 ? "" : "s"}`;
  if (f.totals.deaths === null) {
    points.push(
      `This query returned ${rowsLabel}, but every deaths cell was suppressed by CDC, so no total can be shown.`,
    );
  } else if (suppressed > 0) {
    points.push(
      `This query returned ${rowsLabel} covering at least ${fmt(f.totals.deaths)} deaths — a partial total, because ${fmt(suppressed)} suppressed cell${suppressed === 1 ? "" : "s"} could not be counted.`,
    );
  } else {
    const rate =
      f.totals.rate !== null
        ? `, an overall rate of ${fmt(f.totals.rate, 1)} per ${fmt(per)} population`
        : "";
    points.push(
      `This query returned ${rowsLabel} covering ${fmt(f.totals.deaths)} deaths${rate}.`,
    );
  }

  // ---- leading categories on the main categorical dimension ----
  const catDim = f.dimensions.find((d) => !d.isTime);
  if (catDim && catDim.categories.length >= 2) {
    const vk = catDim.variableKey;
    const ranked = [...catDim.categories].sort((a, b) => (b.deaths ?? -1) - (a.deaths ?? -1));
    const top = ranked[0];
    const share = top.sharePct !== null ? `, ${pct(top.sharePct)} of the deaths shown` : "";
    points.push(
      `The ${subjectPhrase(top.label, vk)} accounted for the most deaths — ${fmt(top.deaths)}${share}${rateText(top, per)}.`,
    );

    if (catDim.top3SharePct !== null && catDim.categoryCount > 3) {
      const names = ranked.slice(0, 3).map((c) => c.label).join(", ");
      points.push(
        `The three largest categories (${names}) together make up ${pct(catDim.top3SharePct)} of the ${fmt(catDim.categoryCount)} shown.`,
      );
    }

    // Rates tell a different story from counts more often than not — and that
    // difference is usually the most useful thing on the screen.
    if (catDim.countRateDiverges && catDim.highestRate?.rate != null) {
      const hr = catDim.highestRate;
      points.push(
        `Counts and rates point at different groups: the highest death rate belongs to the ${subjectPhrase(hr.label, vk)} at ${fmt(hr.rate, 1)} per ${fmt(per)}, even though that group does not have the largest number of deaths.`,
      );
    } else if (catDim.highestRate?.rate != null && catDim.lowestRate?.rate != null && catDim.rateRatio) {
      points.push(
        `Death rates span ${fmt(catDim.rateRatio, 1)}-fold across this breakdown, from ${fmt(catDim.highestRate.rate, 1)} per ${fmt(per)} in the ${subjectPhrase(catDim.highestRate.label, vk)} to ${fmt(catDim.lowestRate.rate, 1)} in the ${subjectPhrase(catDim.lowestRate.label, vk)}.`,
      );
    }

    // A ratio without an interval reads the same whether it rests on twelve
    // deaths or twelve thousand.
    if (catDim.disparity) {
      const r = catDim.disparity;
      points.push(
        r.significant
          ? `The gap between the highest and lowest rates is ${formatRatio(r)} — the interval excludes 1, so it is unlikely to be chance.`
          : `The highest-to-lowest rate ratio is ${formatRatio(r)}, but the interval includes 1: on these counts the difference is not statistically significant.`,
      );
    }

    // Age-adjusted is the comparison that actually holds when groups have
    // different age structures, so it gets its own point when available.
    const hi = catDim.highestAdjusted;
    const lo = catDim.lowestAdjusted;
    if (hi?.ageAdjustedRate != null && lo?.ageAdjustedRate != null && catDim.adjustedRatio) {
      points.push(
        `Adjusting for age — the fair comparison across groups of different age structure — the ${subjectPhrase(hi.label, vk)} has the highest rate at ${fmt(hi.ageAdjustedRate, 1)} per ${fmt(per)} and the ${subjectPhrase(lo.label, vk)} the lowest at ${fmt(lo.ageAdjustedRate, 1)}, a ${fmt(catDim.adjustedRatio, 1)}-fold difference.`,
      );
    }
  }

  // ---- time ----
  if (f.time) {
    const t = f.time;
    const tr = t.deathsTrend;
    if (tr && Number.isFinite(tr.totalChangePct)) {
      const dir = tr.totalChangePct >= 0 ? "rose" : "declined";
      // The trend already excludes incomplete periods; say so, or a reader
      // comparing the bullet with the table will think a year went missing.
      const excluded = t.partialLabels.length
        ? ` ${t.partialLabels.join(" and ")} ${t.partialLabels.length === 1 ? "is" : "are"} left out of this comparison, being incomplete.`
        : "";
      points.push(
        `Across the period, deaths ${dir} ${pct(Math.abs(tr.totalChangePct))}, from ${fmt(tr.first)} in ${tr.firstLabel} to ${fmt(tr.last)} in ${tr.lastLabel}.${excluded}`,
      );
    }
    if (t.rateTrend && Number.isFinite(t.rateTrend.totalChangePct)) {
      const rt = t.rateTrend;
      const dir = rt.totalChangePct >= 0 ? "rose" : "fell";
      points.push(
        `On a population-adjusted basis the crude rate ${dir} ${pct(Math.abs(rt.totalChangePct))} over the same span, from ${fmt(rt.first, 1)} to ${fmt(rt.last, 1)} per ${fmt(per)}.`,
      );
    }
    if (t.peak && tr && t.peak.label !== tr.lastLabel) {
      points.push(`The highest figure came in ${t.peak.label}, at ${fmt(t.peak.value)} deaths.`);
    }
    if (t.largestStep && Math.abs(t.largestStep.changePct) >= 5) {
      const s = t.largestStep;
      points.push(
        `The largest single-period movement was between ${s.from} and ${s.to}, ${s.changePct >= 0 ? "up" : "down"} ${pct(Math.abs(s.changePct))}.`,
      );
    }
    // Divergent series are the point of a grouped time query.
    if (t.bySeries.length >= 2) {
      const sorted = [...t.bySeries].sort((a, b) => b.changePct - a.changePct);
      const up = sorted[0];
      const down = sorted[sorted.length - 1];
      if (Number.isFinite(up.changePct) && Number.isFinite(down.changePct) && up.name !== down.name) {
        points.push(
          `Movement was uneven across ${t.seriesDimLabel ?? "categories"}: ${up.name} changed ${pct(up.changePct)} (${fmt(up.first)} → ${fmt(up.last)}) while ${down.name} changed ${pct(down.changePct)} (${fmt(down.first)} → ${fmt(down.last)}).`,
        );
      }
    }
  }

  // ---- year to date ----
  //
  // The only defensible statement about a partial year: the same months,
  // compared across years, with the newest month left out because certificate
  // processing has not caught up with it.
  const y = f.ytd;
  const change = y?.changePct ?? null;
  if (y && change !== null) {
    const dir = change >= 0 ? "up" : "down";
    points.push(
      `Year to date — the same ${fmt(y.comparedMonths.length)} months (${y.comparedMonths[0]}–${y.comparedMonths[y.comparedMonths.length - 1]}) in each year — ${y.current.label} is ${dir} ${pct(Math.abs(change))} on ${y.previous.label}: ${fmt(y.current.deaths)} deaths against ${fmt(y.previous.deaths)}. ${y.droppedMonths.join(", ")} ${y.droppedMonths.length === 1 ? "is" : "are"} excluded from both years, not yet being fully processed.`,
    );
  }

  // ---- seasonality ----
  if (f.seasonality) {
    points.push(
      `Across the year, ${describeSeasonality(f.seasonality)}. A month-to-month change smaller than that is the calendar rather than a trend.`,
    );
  }

  // ---- concentration beyond what the margins predict ----
  const over = f.interaction?.overRepresented?.[0];
  if (over && over.ratio >= 1.3) {
    points.push(
      `${over.rowLabel} and ${over.colLabel} occur together more often than the overall totals would predict: ${fmt(over.observed)} deaths against ${fmt(over.expected)} expected if the two were unrelated (${fmt(over.ratio, 1)}×).`,
    );
  }

  // ---- provisional-data caveat ----
  if (f.provisional) {
    const partial = f.time?.partialLabels ?? [];
    caveatsProvisional.push(
      partial.length
        ? `These are provisional data. ${partial.join(" and ")} ${partial.length === 1 ? "covers" : "cover"} only part of the period, so ${partial.length === 1 ? "its" : "their"} counts are not comparable with a full period, and recent figures will be revised upward as death certificates are processed.`
        : "These are provisional data: recent periods are still being processed and the counts will be revised upward.",
    );
  }

  // ---- caveats ----
  //
  // These are correctness notes, not nice-to-haves, so they are appended AFTER
  // the trim rather than competing for a slot. Being last in the list, they
  // were previously the first thing a slice() dropped.
  const q = f.dataQuality;
  const caveats: string[] = [];
  if (q.suppressedCells > 0) {
    caveats.push(
      `${fmt(q.suppressedCells)} cell${q.suppressedCells === 1 ? " was" : "s were"} suppressed by CDC (counts of 1–9) to protect confidentiality and are excluded from these totals; interpret accordingly.`,
    );
  }
  if (q.unreliableCells > 0) {
    caveats.push(
      `${fmt(q.unreliableCells)} rate${q.unreliableCells === 1 ? " is" : "s are"} flagged unreliable by CDC because ${q.unreliableCells === 1 ? "it is" : "they are"} based on fewer than 20 deaths.`,
    );
  }

  // Provisional warnings lead the caveats: they change how every figure above
  // should be read, so they must never be the thing a trim drops.
  return [...points.slice(0, 8), ...caveatsProvisional, ...caveats];
}
