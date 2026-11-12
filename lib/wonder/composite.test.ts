// End-to-end for the composite, with CDC replaced by a stub.
//
// The real thing takes about fifty seconds and three requests against a service
// that rate-limits to one every fifteen. These tests drive the same code path
// with a fake fetcher, so the parts that are easy to get quietly wrong — which
// source is asked for which years, whether the age-adjusted rate is computed
// where it is missing, whether anything is double-counted — are checked on
// every run.

import test from "node:test";
import assert from "node:assert/strict";
import type { QuerySpec, ResultCell, ResultTable } from "./types";
import { __forgetMissingYearsForTests, runComposite, yearsCdcRejected } from "./composite";
import { COMBINED_SOURCES } from "./db/combined";
import { measureColumns } from "./buildRequest";
import { standardAgeLabels } from "../stats/ageAdjust";

const s = (v: string): ResultCell => ({ value: v, raw: v });
const n = (v: number): ResultCell => ({ value: v, raw: String(v) });

/** A stub standing in for the CDC endpoint, recording what it was asked. */
function stubFetcher() {
  const calls: QuerySpec[] = [];
  const fetchTable = async (spec: QuerySpec) => {
    calls.push(spec);
    const years = spec.filters?.year ?? [];
    const byAge = spec.groupBy.includes("ageTen");
    const provisional = spec.database === "D176";
    // What the real endpoint would send back: the final files publish the
    // rate, but only for a query CDC will standardise (not one narrowed to a
    // single age group, for instance), which is exactly what measureColumns
    // encodes for the parser.
    const publishesAdjusted = !provisional && measureColumns(spec).includes("ageAdjustedRate");

    const columns: ResultTable["columns"] = [
      { key: "dim_year", label: "Year", kind: "dimension", variableKey: "year" },
      ...(byAge
        ? [
            {
              key: "dim_ageTen",
              label: "Ten-Year Age Groups",
              kind: "dimension" as const,
              variableKey: "ageTen",
            },
          ]
        : []),
      { key: "m_deaths", label: "Deaths", kind: "measure", measureKey: "deaths" },
      { key: "m_population", label: "Population", kind: "measure", measureKey: "population" },
      ...(publishesAdjusted && !byAge
        ? [
            {
              key: "m_ageAdjustedRate",
              label: "Age-Adjusted Rate",
              kind: "measure" as const,
              measureKey: "ageAdjustedRate" as const,
            },
          ]
        : []),
    ];

    // Ten deaths per 100k in every age group, so the age-adjusted rate is
    // exactly 10 and any error in the standardisation shows up immediately.
    // WONDER annotates the year label itself on the provisional file, e.g.
    // "2026 (provisional and partial)" — which is what the join and the notes
    // actually have to cope with.
    const label = (y: string) => (provisional ? `${y} (provisional)` : y);

    const rows: ResultCell[][] = [];
    for (const y of years) {
      if (byAge) {
        for (const ageLabel of standardAgeLabels()) {
          rows.push([s(label(y)), s(ageLabel), n(10), n(100_000)]);
        }
      } else {
        rows.push([
          s(label(y)),
          n(110),
          n(1_100_000),
          ...(publishesAdjusted ? [n(9.5)] : []),
        ]);
      }
    }
    return {
      ok: true as const,
      table: {
        columns,
        rows,
        rowIsTotal: rows.map(() => false),
        caveats: [],
        rowCount: rows.length,
      },
    };
  };
  return { calls, fetchTable };
}

const spec = (over: Partial<QuerySpec> = {}): QuerySpec => ({
  database: "COMBINED",
  groupBy: ["year"],
  measures: ["deaths", "population", "ageAdjustedRate"],
  filters: {},
  options: {},
  ...over,
});

test("one composite query becomes one query per source, each for its own years", async () => {
  const { calls, fetchTable } = stubFetcher();
  const out = await runComposite(spec(), COMBINED_SOURCES, fetchTable);
  assert.ok(out.ok);

  const main = calls.filter((c) => !c.groupBy.includes("ageTen"));
  assert.deepEqual(
    main.map((c) => c.database),
    ["D76", "D158", "D176"],
  );
  const asked = main.flatMap((c) => c.filters?.year ?? []);
  assert.equal(new Set(asked).size, asked.length, "no year is requested twice");
  assert.equal(asked[0], "1999");
});

test("the whole series comes back in order, one row per year", async () => {
  const { fetchTable } = stubFetcher();
  const out = await runComposite(spec(), COMBINED_SOURCES, fetchTable);
  assert.ok(out.ok);
  const years = out.table.rows.map((r) => String(r[0].raw));
  assert.equal(years[0], "1999");
  assert.deepEqual([...years].sort(), years, "chronological");
  assert.equal(new Set(years).size, years.length, "no duplicated year");
});

test("the provisional years get a computed rate; the published ones keep theirs", async () => {
  const { calls, fetchTable } = stubFetcher();
  const out = await runComposite(spec(), COMBINED_SOURCES, fetchTable);
  assert.ok(out.ok);

  // Exactly one companion query, and only for the file that publishes no rate.
  const companions = calls.filter((c) => c.groupBy.includes("ageTen"));
  assert.equal(companions.length, 1);
  assert.equal(companions[0].database, "D176");

  const idx = out.table.columns.findIndex((c) => c.measureKey === "ageAdjustedRate");
  assert.ok(idx > 0);
  const rateFor = (year: string) =>
    out.table.rows.find((r) => String(r[0].raw).startsWith(year))?.[idx].value;
  assert.equal(rateFor("2010"), 9.5, "D76's published rate is untouched");
  assert.equal(rateFor("2024"), 9.5, "D158's published rate is untouched");
  assert.ok(Math.abs(Number(rateFor("2025")) - 10) < 1e-6, "computed from the strata");
});

test("a year filter reaches only the sources that hold those years", async () => {
  const { calls, fetchTable } = stubFetcher();
  const out = await runComposite(spec({ filters: { year: ["2019", "2020"] } }), COMBINED_SOURCES, fetchTable);
  assert.ok(out.ok);
  assert.deepEqual([...new Set(calls.map((c) => c.database))], ["D158"]);
  assert.equal(out.table.rows.length, 2);
});

test("the notes say where each stretch came from and flag the computed rates", async () => {
  const { fetchTable } = stubFetcher();
  const out = await runComposite(spec(), COMBINED_SOURCES, fetchTable);
  assert.ok(out.ok);
  const notes = (out.table.sourceNotes ?? []).join(" ");
  assert.match(notes, /1999/);
  assert.match(notes, /2018/);
  // The reader must not be able to mistake a rate computed here for a CDC one.
  assert.match(notes, /computed here/);
  assert.match(notes, /CDC does not publish these figures/);
  // WONDER's own year annotation belongs on the axis, not spliced into the
  // middle of a sentence: "2025 (provisional)-2026 (provisional and partial)
  // from ..." is unreadable, and the note says provisional in words anyway.
  assert.ok(!/\(provisional\)–/.test(notes), notes);
});

test("one source failing fails the query, rather than returning a short series", async () => {
  // A silently truncated trend is worse than an error: it looks like a finding.
  const { fetchTable } = stubFetcher();
  const failing = async (q: QuerySpec) =>
    q.database === "D158"
      ? { ok: false as const, error: "CDC returned 503", status: 503 }
      : fetchTable(q);
  const out = await runComposite(spec(), COMBINED_SOURCES, failing);
  assert.ok(!out.ok);
  assert.match(out.error, /503/);
});

test("losing the companion query costs the measure, not the series", async () => {
  // The other years are still correct, so the right outcome is a blank cell.
  const { fetchTable } = stubFetcher();
  const noCompanion = async (q: QuerySpec) =>
    q.groupBy.includes("ageTen")
      ? { ok: false as const, error: "CDC returned 429", status: 429 }
      : fetchTable(q);
  const out = await runComposite(spec(), COMBINED_SOURCES, noCompanion);
  assert.ok(out.ok, "the query still succeeds");
  const idx = out.table.columns.findIndex((c) => c.measureKey === "ageAdjustedRate");
  const row2025 = out.table.rows.find((r) => String(r[0].raw).startsWith("2025"));
  assert.equal(row2025?.[idx].value, null, "blank, not absent and not wrong");
  assert.equal(
    out.table.rows.find((r) => String(r[0].raw).startsWith("2024"))?.[idx].value,
    9.5,
  );
});

test("a query already grouped by age is not standardised over itself", async () => {
  const { calls, fetchTable } = stubFetcher();
  const out = await runComposite(
    spec({ groupBy: ["year", "ageTen"] }),
    COMBINED_SOURCES,
    fetchTable,
  );
  assert.ok(out.ok);
  // Every call is the grouped query itself; none is a companion added on top.
  assert.ok(calls.every((c) => c.groupBy.filter((g) => g === "ageTen").length === 1));
});

// ---------------------------------------------------------------------------
// A year the provisional file does not have yet.
// ---------------------------------------------------------------------------

/** CDC's reply, word for word, to a request naming a year it has no rows for. */
const invalidYear = (y: string) =>
  `HTTP 500: Invalid 'Year/Month' codes were found: '${y}'. Check the Finder Tool for valid Year/Month codes.`;

/** The usual stub, except that D176 refuses any request naming `missing`. */
function stubWithoutYear(missing: string) {
  const inner = stubFetcher();
  const calls: QuerySpec[] = [];
  const fetchTable = async (spec: QuerySpec) => {
    calls.push(spec);
    if (spec.database === "D176" && (spec.filters.year ?? []).includes(missing)) {
      return {
        ok: false as const,
        error: "CDC WONDER could not run this query.",
        status: 502,
        detail: invalidYear(missing),
      };
    }
    return inner.fetchTable(spec);
  };
  return { calls, fetchTable };
}

test("CDC's invalid-year message is read for the years it names", () => {
  assert.deepEqual(yearsCdcRejected(invalidYear("2027")), ["2027"]);
  assert.deepEqual(
    yearsCdcRejected("Invalid 'Year/Month' codes were found: '2027', '2028'. Check the Finder Tool."),
    ["2027", "2028"],
  );
  assert.deepEqual(yearsCdcRejected("HTTP 403: (no detail)"), []);
  assert.deepEqual(yearsCdcRejected("Age Adjusted Rates are not available."), []);
});

test("a year CDC has not published yet is dropped and the series still arrives", async () => {
  __forgetMissingYearsForTests();
  // Every January the calendar says there is a new year before CDC's
  // provisional file does. The newest year the composite asks for stands in.
  const all = stubFetcher();
  await runComposite(spec(), COMBINED_SOURCES, all.fetchTable);
  const newest = all.calls.filter((c) => c.database === "D176")[0].filters.year!.slice(-1)[0];

  const { calls, fetchTable } = stubWithoutYear(newest);
  const out = await runComposite(spec(), COMBINED_SOURCES, fetchTable);
  assert.ok(out.ok, out.ok ? "" : out.error);
  const years = out.table.rows.map((r) => String(r[0].raw));
  assert.ok(!years.some((y) => y.startsWith(newest)), "the missing year is not in the result");
  assert.ok(years.some((y) => y.startsWith(String(Number(newest) - 1))), "the year before it is");

  // Refused once, asked again without it; and the companion age query that
  // computes the adjusted rate must not walk into the same refusal.
  const d176 = calls.filter((c) => c.database === "D176");
  assert.equal(d176.filter((c) => (c.filters.year ?? []).includes(newest)).length, 1);
  const idx = out.table.columns.findIndex((c) => c.measureKey === "ageAdjustedRate");
  const lastRow = out.table.rows[out.table.rows.length - 1];
  assert.equal(typeof lastRow[idx].value, "number", "computed rate still filled in");

  // And it is remembered: the next query does not pay for the lesson again.
  const second = stubWithoutYear(newest);
  const again = await runComposite(spec(), COMBINED_SOURCES, second.fetchTable);
  assert.ok(again.ok);
  assert.equal(
    second.calls.filter((c) => (c.filters.year ?? []).includes(newest)).length,
    0,
    "the refused year was not asked for a second time",
  );
  __forgetMissingYearsForTests();
});

test("an age filter CDC will not adjust over costs no companion query", async () => {
  // CDC refuses the age-adjusted rate for a single age group, so the builder
  // does not ask the final files for it; computing it for the provisional
  // years alone would put a rate on two years and blanks on the other 26.
  const { calls, fetchTable } = stubFetcher();
  const out = await runComposite(
    spec({ filters: { ageTen: ["15-24"] } }),
    COMBINED_SOURCES,
    fetchTable,
  );
  assert.ok(out.ok, out.ok ? "" : out.error);
  assert.equal(calls.filter((c) => c.groupBy.includes("ageTen")).length, 0);
  // And no column of blanks where the rate would have been.
  assert.ok(!out.table.columns.some((c) => c.measureKey === "ageAdjustedRate"));
});
