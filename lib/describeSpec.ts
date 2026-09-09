// Human-readable descriptions of the active query, so a figure or table can
// state its own filters (important when a chart is exported and viewed away
// from the app).

import type { QuerySpec } from "./wonder/types";
import { MANNER_OF_DEATH } from "./wonder/databases";
import { getDatabase, variableByKey } from "./wonder/db/registry";

/** Collapse a sorted year list into ranges: 2019,2020,2021,2024 -> "2019–2021, 2024". */
function summarizeYears(codes: string[]): string {
  const years = [...new Set(codes.map(Number).filter(Number.isFinite))].sort(
    (a, b) => a - b,
  );
  if (years.length === 0) return codes.join(", ");
  const parts: string[] = [];
  let start = years[0];
  let prev = years[0];
  for (let i = 1; i <= years.length; i++) {
    const y = years[i];
    if (y !== prev + 1) {
      parts.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = y;
    }
    prev = y;
  }
  return parts.join(", ");
}

// Variable labels and value lists differ per dataset, so every helper takes
// the spec's variable map rather than reaching for a module-level D158 one.
type VarMap = Record<string, { label: string; values: { code: string; label: string }[] }>;
const varsOf = (spec: QuerySpec): VarMap =>
  variableByKey(getDatabase(spec.database)) as unknown as VarMap;

function labelsFor(vars: VarMap, key: string, codes: string[]): string {
  if (key === "year") return summarizeYears(codes);
  // Manner of Death uses friendlier labels than the raw WONDER intent values.
  const source = key === "injuryIntent" ? MANNER_OF_DEATH : vars[key]?.values ?? [];
  const labels = codes.map(
    (c) => source.find((v) => v.code === c)?.label ?? c,
  );
  // Long lists get truncated so a chart caption stays readable.
  if (labels.length > 4) {
    return `${labels.slice(0, 3).join(", ")} +${labels.length - 3} more`;
  }
  return labels.join(", ");
}

function displayName(vars: VarMap, key: string): string {
  if (key === "injuryIntent") return "Manner";
  if (key === "injuryMechanism") return "Mechanism";
  if (key === "ucdCause") return "ICD-10";
  return vars[key]?.label ?? key;
}

/** One "Field: values" chip per active filter. */
export function filterChips(spec: QuerySpec): { key: string; label: string; value: string }[] {
  const vars = varsOf(spec);
  return Object.entries(spec.filters ?? {})
    .filter(([, codes]) => codes && codes.length > 0)
    .map(([key, codes]) => ({
      key,
      label: displayName(vars, key),
      value: labelsFor(vars, key, codes),
    }));
}

/** Single-line summary, e.g. "Manner: Suicide · Sex: Male · Year: 2019–2024". */
export function describeFilters(spec: QuerySpec): string {
  const chips = filterChips(spec);
  if (chips.length === 0) return "All deaths, all years (no filters applied)";
  return chips.map((c) => `${c.label}: ${c.value}`).join(" · ");
}

/** "Deaths by Year and Race" style description of what's being shown. */
export function describeGrouping(spec: QuerySpec): string {
  const vars = varsOf(spec);
  const groups = (spec.groupBy ?? []).map((k) => vars[k]?.label ?? k);
  if (groups.length === 0) return "";
  const last = groups[groups.length - 1];
  const head = groups.slice(0, -1);
  return head.length ? `${head.join(", ")} and ${last}` : last;
}

/**
 * The lines drawn under an exported figure so it stands on its own once it has
 * left the app: what is plotted, what was filtered, and where the data came
 * from. A chart on a slide with no source line is not citable.
 */
export function figureCaption(spec: QuerySpec): string[] {
  const lines: string[] = [];
  const grouping = describeGrouping(spec);
  if (grouping) lines.push(`Grouped by ${grouping}`);
  lines.push(describeFilters(spec));
  const db = getDatabase(spec.database);
  lines.push(
    `Source: CDC/NCHS, ${db.label}, via CDC WONDER (national data). Rates per 100,000.`,
  );
  // A figure built on provisional data must say so wherever it ends up: the
  // most recent periods are incomplete and will be revised upward.
  if (db.provisional) {
    lines.push(
      "Provisional data: the most recent periods are incomplete and subject to revision.",
    );
  }
  return lines;
}
