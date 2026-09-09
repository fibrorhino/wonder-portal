import test from "node:test";
import assert from "node:assert/strict";
import type { QuerySpec, ResultCell, ResultColumn, ResultTable } from "./wonder/types";
import { buildMethods, methodsForClipboard } from "./methods";

const n = (v: number): ResultCell => ({ value: v, raw: String(v) });
const s = (v: string): ResultCell => ({ value: v, raw: v });
const AT = new Date("2026-09-09T12:00:00Z");

function yearTable(years: string[], sourceNotes?: string[]): ResultTable {
  const columns: ResultColumn[] = [
    { key: "dim_year", label: "Year", kind: "dimension", variableKey: "year" },
    { key: "m_deaths", label: "Deaths", kind: "measure", measureKey: "deaths" },
  ];
  const rows = years.map((y) => [s(y), n(1000)]);
  return {
    columns,
    rows,
    rowIsTotal: rows.map(() => false),
    caveats: [],
    rowCount: rows.length,
    ...(sourceNotes ? { sourceNotes } : {}),
  };
}

const spec = (over: Partial<QuerySpec> = {}): QuerySpec => ({
  database: "D158",
  groupBy: ["year"],
  measures: ["deaths", "population", "crudeRate", "ageAdjustedRate"],
  filters: { injuryIntent: ["2"] },
  options: { ratePer: 100000 },
  ...over,
});

test("the methods name the database, the selection and the standard population", () => {
  const m = buildMethods(spec(), yearTable(["2018", "2024"]), AT);
  assert.match(m.methods, /Underlying Cause of Death, 2018-2024, Single Race/);
  assert.match(m.methods, /2018 to 2024/);
  assert.match(m.methods, /manner was Suicide/);
  assert.match(m.methods, /2000 US standard population/);
  assert.match(m.methods, /per 100,000/);
});

test("suppression and the national-only limit are always stated", () => {
  // Both are constraints on what the numbers can support, not trivia: a total
  // with suppressed cells excluded is not the true total, and a reader may
  // assume state data was available and simply not used.
  const m = buildMethods(spec(), yearTable(["2020"]), AT);
  assert.match(m.methods, /1 to 9/);
  assert.match(m.methods, /fewer than 20 deaths/);
  assert.match(m.methods, /does not release sub-national data/);
});

test("a query with no filters says so rather than omitting the sentence", () => {
  // describeFilters returns "All deaths, all years (no filters applied)" here,
  // which read as "Deaths were selected where All deaths, all years..." — so
  // the chip list is the source of truth for whether anything was filtered.
  const m = buildMethods(spec({ filters: {} }), yearTable(["2020"]), AT);
  assert.match(m.methods, /No cause or demographic restriction/);
  assert.ok(!/selected where All deaths/.test(m.methods), m.methods);
});

test("a single-year result does not read \"covering 2020 to 2020\"", () => {
  const m = buildMethods(spec(), yearTable(["2020"]), AT);
  assert.match(m.methods, /covering 2020\./);
});

test("several filters are joined into one readable clause", () => {
  const m = buildMethods(spec({ filters: { injuryIntent: ["2"], sex: ["M"] } }), yearTable(["2020"]), AT);
  assert.match(m.methods, /manner was Suicide, and sex was Male\./);
});

test("the citation carries the accession date and a verified WONDER URL", () => {
  const m = buildMethods(spec(), yearTable(["2020"]), AT);
  assert.equal(m.citations.length, 1);
  assert.match(m.citations[0], /Accessed at https:\/\/wonder\.cdc\.gov\/ucd-icd10-expanded\.html on Sep 9, 2026\./);
  assert.match(m.citations[0], /Multiple Cause of Death Files, 2018-2024/);
  assert.equal(m.accessed, "2026-09-09");
  // The release-year clause is deliberately absent: the API does not report
  // one, and a guessed year in a bibliography is a wrong fact.
  assert.ok(!/released in/i.test(m.citations[0]), m.citations[0]);
});

test("a combined series cites every file it drew on", () => {
  const m = buildMethods(
    spec({ database: "COMBINED" }),
    yearTable(["1999", "2026"], ["1999-2017 from A.", "2018-2024 from B."]),
    AT,
  );
  assert.equal(m.citations.length, 3, "one per source file");
  const all = m.citations.join(" ");
  assert.match(all, /ucd-icd10\.html/);
  assert.match(all, /ucd-icd10-expanded\.html/);
  assert.match(all, /mcd-icd10-provisional\.html/);
});

test("the combined methods reuse the stitch notes rather than restating them", () => {
  // Two independent prose descriptions of the same provenance would drift.
  const notes = ["1999-2017 from Underlying Cause of Death, 1999-2020.", "2025-2026 from Provisional."];
  const m = buildMethods(spec({ database: "COMBINED" }), yearTable(["1999"], notes), AT);
  for (const note of notes) assert.ok(m.methods.includes(note), `missing: ${note}`);
});

test("a computed age-adjusted rate is disclosed in the methods", () => {
  // Publishing a rate CDC did not publish, without saying so, is the one thing
  // this generator must never let a manuscript do.
  const m = buildMethods(
    spec({ database: "COMBINED" }),
    yearTable(["2025"], ["Age-adjusted rates for 2025 were computed here ... CDC does not publish these figures."]),
    AT,
  );
  assert.match(m.methods, /not published by CDC and were computed for this analysis/);
  assert.match(m.methods, /within 0\.02 per 100,000/);
});

test("no computed-rate claim appears when nothing was computed", () => {
  const m = buildMethods(spec(), yearTable(["2020"]), AT);
  assert.ok(!/computed for this analysis/.test(m.methods));
});

test("the provisional warning tracks the database, not the wording of a caveat", () => {
  assert.match(buildMethods(spec({ database: "D176" }), yearTable(["2025"]), AT).methods, /provisional/i);
  assert.ok(!/subject to upward revision/.test(buildMethods(spec(), yearTable(["2020"]), AT).methods));
});

test("the clipboard block is labelled and keeps citations separate from prose", () => {
  const m = buildMethods(spec({ database: "COMBINED" }), yearTable(["1999"]), AT);
  const text = methodsForClipboard(m);
  assert.match(text, /^METHODS\n/);
  assert.match(text, /\nCITATIONS\n/);
  assert.match(text, /\n1\. Centers for Disease Control/);
});

test("a table with no year column still produces usable methods", () => {
  // Grouping by sex alone: there is no observed year range to report, and the
  // paragraph must not read "covering undefined to undefined".
  const columns: ResultColumn[] = [
    { key: "dim_sex", label: "Sex", kind: "dimension", variableKey: "sex" },
    { key: "m_deaths", label: "Deaths", kind: "measure", measureKey: "deaths" },
  ];
  const t: ResultTable = {
    columns,
    rows: [[s("Male"), n(10)]],
    rowIsTotal: [false],
    caveats: [],
    rowCount: 1,
  };
  const m = buildMethods(spec({ groupBy: ["sex"] }), t, AT);
  assert.ok(!/undefined/.test(m.methods), m.methods);
  assert.ok(!/covering/.test(m.methods));
  assert.match(m.methods, /tabulated by sex/i);
});
