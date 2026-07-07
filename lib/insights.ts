// Rule-based "talking points" for a ResultTable — no AI required. Inspects the
// aggregated data and emits a few plain-English observations (total, top/bottom
// groups, time trend, suppression). A later AI pass can polish these; the raw
// facts here are deterministic and safe.

import type { ResultTable } from "./wonder/types";
import {
  cellLabel,
  cellNumber,
  dataRows,
  dimensionCols,
  measureCols,
  numericEncode,
} from "./tableUtils";
import { trend } from "./stats/summary";

function fmt(n: number, d = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}

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

export function talkingPoints(table: ResultTable): string[] {
  const rows = dataRows(table);
  const dims = dimensionCols(table);
  const measures = measureCols(table);
  if (rows.length === 0 || measures.length === 0) return ["No records matched this query."];

  const mCol = measures.find((m) => m.column.measureKey === "deaths") ?? measures[0];
  const isRate = mCol.column.measureKey === "crudeRate" || mCol.column.measureKey === "ageAdjustedRate";
  const mLabel = mCol.column.label.toLowerCase();
  const mi = mCol.index;

  const points: string[] = [];

  // Suppression
  const suppressed = rows.filter((r) => r[mi]?.flag === "suppressed").length;

  // Total (only meaningful for counts, not rates)
  const values = rows.map((r) => cellNumber(r[mi])).filter((v): v is number => v !== null);
  const total = values.reduce((a, b) => a + b, 0);
  if (!isRate) {
    points.push(
      `This query returned ${fmt(rows.length)} group${rows.length === 1 ? "" : "s"}, encompassing a total of ${fmt(total)} ${mLabel}.`,
    );
  }

  // Primary categorical dimension (first non-time dimension), else first dim
  const timeKeys = ["year", "month"];
  const catDim = dims.find((d) => !timeKeys.includes(d.column.variableKey ?? "")) ?? dims[0];
  if (catDim) {
    const byCat = new Map<string, number>();
    for (const r of rows) {
      const k = cellLabel(r[catDim.index]);
      const v = cellNumber(r[mi]);
      if (v !== null) byCat.set(k, (byCat.get(k) ?? 0) + v);
    }
    const sorted = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    const vk = catDim.column.variableKey;
    if (sorted.length >= 2) {
      const [topName, topVal] = sorted[0];
      const pct = total > 0 && !isRate ? `, accounting for ${fmt((topVal / total) * 100, 1)}% of the total shown` : "";
      const verb = isRate ? "demonstrated the highest" : "recorded the greatest number of";
      points.push(`The ${subjectPhrase(topName, vk)} ${verb} ${mLabel} (${fmt(topVal, isRate ? 1 : 0)}${pct}).`);
      const nonZero = sorted.filter(([, v]) => v > 0);
      if (nonZero.length >= 2) {
        const [lowName, lowVal] = nonZero[nonZero.length - 1];
        points.push(`The fewest were observed in the ${subjectPhrase(lowName, vk)} (${fmt(lowVal, isRate ? 1 : 0)}).`);
      }
    }
  }

  // Time trend
  const timeDim = dims.find((d) => timeKeys.includes(d.column.variableKey ?? ""));
  if (timeDim) {
    const byT = new Map<string, number>();
    for (const r of rows) {
      const k = cellLabel(r[timeDim.index]);
      const v = cellNumber(r[mi]);
      if (v !== null) byT.set(k, (byT.get(k) ?? 0) + v);
    }
    const pts = [...byT.entries()]
      .map(([label, value]) => ({ label, value, ord: numericEncode(timeDim.column.variableKey, label) ?? 0 }))
      .sort((a, b) => a.ord - b.ord);
    const tr = trend(pts);
    if (tr && Number.isFinite(tr.totalChangePct)) {
      const dir = tr.totalChangePct >= 0 ? "rose" : "declined";
      points.push(
        `Over the period examined, ${mLabel} ${dir} ${fmt(Math.abs(tr.totalChangePct), 1)}%, from ${fmt(tr.first, isRate ? 1 : 0)} in ${tr.firstLabel} to ${fmt(tr.last, isRate ? 1 : 0)} in ${tr.lastLabel}${Number.isFinite(tr.cagrPct) ? ` (approximately ${fmt(Math.abs(tr.cagrPct), 1)}% per year)` : ""}.`,
      );
      const peak = pts.reduce((a, b) => (b.value > a.value ? b : a));
      if (peak.label !== tr.lastLabel) points.push(`The highest figure was reached in ${peak.label} (${fmt(peak.value, isRate ? 1 : 0)}).`);
    }
  }

  if (suppressed > 0) {
    points.push(`${suppressed} cell${suppressed === 1 ? " was" : "s were"} suppressed by CDC (counts of 1–9) to protect confidentiality and are excluded from these totals; interpret accordingly.`);
  }

  return points.slice(0, 6);
}
