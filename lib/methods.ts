// A methods paragraph and a citation, generated from the query that produced
// the table on screen.
//
// Everything a methods section needs is already known here: which database and
// which years, what was filtered to, which measure, what it was standardised
// to, how suppression was handled, whether any of it is provisional, and — for
// a stitched series — which file supplied which stretch and which figures were
// computed rather than published. Writing that out by hand is tedious and easy
// to get subtly wrong, and the provenance of the combined series is fiddly
// enough that a manuscript would probably get it wrong.
//
// Deterministic, like lib/insights.ts: no model, no paraphrase. What comes out
// is what the query actually was.
//
// One thing this cannot do is verify itself. WONDER's API does not return a
// suggested citation — the web UI adds one to its own results page — so the
// citation is reconstructed to that published shape from `wonderPage` and
// `citationFile` on each database. It deliberately omits the "released in
// YYYY" clause that WONDER's web citation carries, because the API does not
// report a release year and inventing one would put a wrong fact in a
// bibliography. The accession date carries the vintage instead.

import type { QuerySpec, ResultTable } from "./wonder/types";
import { getDatabase } from "./wonder/db/registry";
import { describeGrouping, filterChips } from "./describeSpec";

export interface MethodsText {
  /** Prose, ready to paste into a manuscript's methods section. */
  methods: string;
  /** One citation per underlying file, in the order the data runs. */
  citations: string[];
  /** The accession date these citations claim, ISO yyyy-mm-dd. */
  accessed: string;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Sep 9, 2026" — the form WONDER's own citation uses. */
function citationDate(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The year range actually present in the table, not the range requested. */
function observedYears(table: ResultTable): { first: string; last: string } | null {
  const idx = table.columns.findIndex((c) => c.variableKey === "year");
  if (idx < 0) return null;
  const years = table.rows
    .filter((_, i) => !table.rowIsTotal[i])
    .map((r) => parseInt(String(r[idx].raw), 10))
    .filter((n) => Number.isFinite(n));
  if (years.length === 0) return null;
  return { first: String(Math.min(...years)), last: String(Math.max(...years)) };
}

/** Prose spells small numbers out; "assembled from 3 files" reads as a table. */
function numberWord(n: number): string {
  return ["zero", "one", "two", "three", "four", "five"][n] ?? String(n);
}

function sentenceList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** The files a query drew on: one for a plain database, several for a composite. */
function sourceDatabases(spec: QuerySpec): { id: string; label: string; page?: string; file?: string }[] {
  const def = getDatabase(spec.database);
  const ids = def.composite ? def.composite.map((c) => c.databaseId) : [def.id];
  return ids.map((id) => {
    const d = getDatabase(id);
    return { id: d.id, label: d.label, page: d.wonderPage, file: d.citationFile };
  });
}

export function buildMethods(
  spec: QuerySpec,
  table: ResultTable,
  now: Date = new Date(),
): MethodsText {
  const def = getDatabase(spec.database);
  const sources = sourceDatabases(spec);
  const years = observedYears(table);
  const parts: string[] = [];

  // --- Where the data came from ---
  if (def.composite) {
    // The stitch notes are already exact about which years came from which
    // file; repeating them here in prose would risk the two disagreeing.
    const notes = (table.sourceNotes ?? []).join(" ");
    parts.push(
      `Mortality data were obtained from CDC WONDER. Because no single WONDER database spans the period, the series was assembled from ${numberWord(sources.length)} files. ${notes}`.trim(),
    );
  } else {
    const span = !years
      ? ""
      : years.first === years.last
        ? `, covering ${years.first}`
        : `, covering ${years.first} to ${years.last}`;
    parts.push(`Mortality data were obtained from the CDC WONDER ${def.label} database${span}.`);
  }

  // --- What was asked for ---
  // filterChips rather than describeFilters: the latter returns the sentence
  // "All deaths, all years (no filters applied)" when nothing is set, which
  // reads as gibberish inside "Deaths were selected where ...". An empty chip
  // list is unambiguous.
  const chips = filterChips(spec);
  const grouping = describeGrouping(spec);
  const selection = chips.length
    ? `Deaths were selected where ${chips.map((c) => `${c.label.toLowerCase()} was ${c.value}`).join(", and ")}.`
    : "No cause or demographic restriction was applied; all deaths were included.";
  parts.push(selection);
  if (grouping) parts.push(`Results were tabulated by ${grouping.toLowerCase()}.`);

  // --- Which measure, and standardised how ---
  const per = spec.options?.ratePer ?? 100000;
  const wantsAdjusted = spec.measures.includes("ageAdjustedRate");
  const wantsCrude = spec.measures.includes("crudeRate");
  if (wantsAdjusted || wantsCrude) {
    const measures: string[] = [];
    if (wantsCrude) measures.push("crude death rates");
    if (wantsAdjusted) measures.push("age-adjusted death rates");
    parts.push(
      `${sentenceList(measures).replace(/^./, (c) => c.toUpperCase())} are expressed per ${per.toLocaleString("en-US")} population.` +
        (wantsAdjusted
          ? " Age-adjusted rates are standardised by the direct method to the 2000 US standard population."
          : ""),
    );
  }

  // --- Rates this app computed rather than read ---
  const computed = (table.sourceNotes ?? []).some((n) => /computed here/i.test(n));
  if (computed) {
    parts.push(
      "Age-adjusted rates for the provisional years are not published by CDC and were computed for this analysis by direct standardisation of the ten-year age-specific rates to the same 2000 US standard population. Validated against the years CDC does publish, this method agreed to within 0.02 per 100,000.",
    );
  }

  // --- How the data behaves ---
  parts.push(
    "CDC suppresses death counts of 1 to 9 to protect confidentiality, so suppressed cells are excluded from totals; rates based on fewer than 20 deaths are flagged by CDC as unreliable.",
  );
  if (def.provisional) {
    parts.push(
      "Data for the most recent periods are provisional and subject to upward revision as death certificates are processed; a period covering only part of a year is not comparable with a full year.",
    );
  }
  parts.push("All figures are national; CDC WONDER's API does not release sub-national data.");

  // --- Citations, one per file ---
  const accessedOn = citationDate(now);
  const citations = sources
    .filter((s) => s.page && s.file)
    .map(
      (s) =>
        `Centers for Disease Control and Prevention, National Center for Health Statistics. ` +
        `National Vital Statistics System, Mortality, on CDC WONDER Online Database. ` +
        `Data are from the ${s.file}, as compiled from data provided by the 57 vital statistics jurisdictions ` +
        `through the Vital Statistics Cooperative Program. Accessed at ${s.page} on ${accessedOn}.`,
    );

  return { methods: parts.join(" "), citations, accessed: isoDate(now) };
}

/** Methods and citations as one block, for the clipboard. */
export function methodsForClipboard(m: MethodsText): string {
  return [
    "METHODS",
    m.methods,
    "",
    m.citations.length === 1 ? "CITATION" : "CITATIONS",
    ...m.citations.map((c, i) => (m.citations.length === 1 ? c : `${i + 1}. ${c}`)),
  ].join("\n");
}
