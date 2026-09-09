import test from "node:test";
import assert from "node:assert/strict";
import type { ResultCell, ResultColumn, ResultTable } from "./types";
import { spliceAdjustedRates, stitchTables } from "./stitch";
import { yearsForSource, COMBINED_SOURCES } from "./db/combined";
import { ageAdjustedRate, standardAgeLabels } from "../stats/ageAdjust";

const n = (v: number): ResultCell => ({ value: v, raw: String(v) });
const s = (v: string): ResultCell => ({ value: v, raw: v });
const blank = (): ResultCell => ({ value: null, raw: "" });

function table(
  dims: { key: string; label: string }[],
  measures: string[],
  rows: ResultCell[][],
  totals: boolean[] = [],
): ResultTable {
  const columns: ResultColumn[] = [
    ...dims.map((d) => ({
      key: `dim_${d.key}`,
      label: d.label,
      kind: "dimension" as const,
      variableKey: d.key,
    })),
    ...measures.map((m) => ({
      key: `m_${m}`,
      label: m,
      kind: "measure" as const,
      measureKey: m as never,
    })),
  ];
  return {
    columns,
    rows,
    rowIsTotal: rows.map((_, i) => totals[i] ?? false),
    caveats: [],
    rowCount: rows.length,
  };
}

const yearTable = (years: [string, number][], totals: boolean[] = []) =>
  table(
    [{ key: "year", label: "Year" }],
    ["deaths"],
    years.map(([y, d]) => [s(y), n(d)]),
    totals,
  );

test("sources are joined in chronological order regardless of arrival order", () => {
  const out = stitchTables([
    { databaseId: "D176", table: yearTable([["2025", 30]]) },
    { databaseId: "D76", table: yearTable([["1999", 10]]) },
    { databaseId: "D158", table: yearTable([["2018", 20]]) },
  ]);
  assert.ok(!("error" in out));
  assert.deepEqual(
    out.table.rows.map((r) => r[0].raw),
    ["1999", "2018", "2025"],
  );
  assert.equal(out.table.rowCount, 3);
});

test("per-source totals are dropped, since each totals only a slice", () => {
  // Left in, a "Total" row would sit in the middle of the joined series and be
  // charted as a data point.
  const withTotal = yearTable(
    [["1999", 10], ["2000", 12], ["Total", 22]],
    [false, false, true],
  );
  const out = stitchTables([
    { databaseId: "D76", table: withTotal },
    { databaseId: "D158", table: yearTable([["2018", 20]]) },
  ]);
  assert.ok(!("error" in out));
  assert.equal(out.table.rows.length, 3);
  assert.ok(!out.table.rows.some((r) => r[0].raw === "Total"));
  assert.ok(out.table.rowIsTotal.every((t) => t === false));
});

test("mismatched column layouts are refused rather than merged", () => {
  // Concatenating these would put mechanism labels into the sex column and
  // report it as data.
  const bySex = table([{ key: "sex", label: "Sex" }], ["deaths"], [[s("Male"), n(1)]]);
  const out = stitchTables([
    { databaseId: "D76", table: yearTable([["1999", 10]]) },
    { databaseId: "D158", table: bySex },
  ]);
  assert.ok("error" in out);
  assert.match(out.error, /different column layout/);
});

test("provenance records which file supplied which years", () => {
  const out = stitchTables([
    { databaseId: "D76", table: yearTable([["1999", 10], ["2000", 11]]) },
    { databaseId: "D158", table: yearTable([["2018", 20]]) },
  ]);
  assert.ok(!("error" in out));
  assert.deepEqual(out.provenance, [
    { databaseId: "D76", years: ["1999", "2000"] },
    { databaseId: "D158", years: ["2018"] },
  ]);
});

test("each source is asked only for the years it covers, and none twice", () => {
  const all = Array.from({ length: 28 }, (_, i) => String(1999 + i));
  const [hist, final, prov] = COMBINED_SOURCES;
  assert.deepEqual(yearsForSource(hist, undefined, all).slice(-1), ["2017"]);
  assert.equal(yearsForSource(final, undefined, all)[0], "2018");
  assert.deepEqual(yearsForSource(final, undefined, all).slice(-1), ["2024"]);
  assert.equal(yearsForSource(prov, undefined, all)[0], "2025");
  // Duplicating a year would double-count it in every total.
  const covered = [hist, final, prov].flatMap((src) => yearsForSource(src, undefined, all));
  assert.equal(new Set(covered).size, covered.length, "no year is fetched twice");
});

test("a year filter narrows which sources are queried at all", () => {
  // Asking only for 2019-2021 must not spend a CDC call on the other two files.
  const all = Array.from({ length: 28 }, (_, i) => String(1999 + i));
  const [hist, final, prov] = COMBINED_SOURCES;
  const wanted = ["2019", "2020", "2021"];
  assert.deepEqual(yearsForSource(hist, wanted, all), []);
  assert.deepEqual(yearsForSource(final, wanted, all), wanted);
  assert.deepEqual(yearsForSource(prov, wanted, all), []);
});

test("age adjustment leaves a rate alone when every stratum shares it", () => {
  // Identical rate in every age group: standardising cannot change it.
  const strata = standardAgeLabels().map((ageLabel) => ({
    ageLabel,
    deaths: 10,
    population: 100_000,
  }));
  const r = ageAdjustedRate(strata);
  assert.ok(r);
  assert.ok(Math.abs(r.rate - 10) < 1e-9, `got ${r.rate}`);
  assert.ok(r.coverage > 0.999);
});

test("age adjustment removes the effect of an older population", () => {
  // Two populations with identical age-specific rates but different age
  // structures. Their crude rates differ hugely; their adjusted rates must not
  // — that is the entire purpose of the measure.
  const ageRates = [1, 1, 2, 5, 8, 15, 30, 60, 120, 250, 500];
  const labels = standardAgeLabels();
  const build = (weights: number[]) =>
    labels.map((ageLabel, i) => ({
      ageLabel,
      population: weights[i],
      deaths: (ageRates[i] / 100000) * weights[i],
    }));
  const young = build([200, 800, 2000, 2000, 1800, 1500, 1000, 500, 300, 150, 50]);
  const old = build([50, 200, 500, 600, 800, 1000, 1200, 1500, 1800, 1500, 900]);

  const crude = (st: { deaths: number; population: number }[]) =>
    (st.reduce((a, x) => a + x.deaths, 0) / st.reduce((a, x) => a + x.population, 0)) * 100000;
  assert.ok(crude(old) > crude(young) * 2, "crude rates differ a lot");

  const a = ageAdjustedRate(young);
  const b = ageAdjustedRate(old);
  assert.ok(a && b);
  assert.ok(Math.abs(a.rate - b.rate) < 1e-6, `${a.rate} vs ${b.rate}`);
});

test("too little of the age range gives no rate rather than a mislabelled one", () => {
  // Standardising over a third of the age range produces a different number
  // wearing the name "age-adjusted".
  const partial = standardAgeLabels()
    .slice(0, 4)
    .map((ageLabel) => ({ ageLabel, deaths: 10, population: 100_000 }));
  assert.equal(ageAdjustedRate(partial), null);
});

test("an age group absent from the data counts as no deaths, not as missing", () => {
  // WONDER omits age groups with no records, so a suicide query returns nothing
  // at all for under-5s. Rescaling by the range that did come back would assume
  // infants die of suicide at the same rate as everyone else.
  const withoutInfants = standardAgeLabels()
    .slice(2)
    .map((ageLabel) => ({ ageLabel, deaths: 10, population: 100_000 }));
  const r = ageAdjustedRate(withoutInfants);
  assert.ok(r, "6.9% of the standard population missing is still usable");
  // 10 per 100k across 93.1% of the standard population, zero across the rest.
  assert.ok(Math.abs(r.rate - 9.31) < 0.02, `got ${r.rate}`);
  assert.ok(Math.abs(r.coverage - 0.931) < 0.002);
});

test("computed rates fill only the gaps, never overwrite a published one", () => {
  const t = table(
    [{ key: "year", label: "Year" }],
    ["deaths", "ageAdjustedRate"],
    [
      [s("2024"), n(100), n(12.5)],
      [s("2025"), n(110), blank()],
    ],
  );
  const filled = spliceAdjustedRates(
    t,
    new Map([
      ["2024", 99.9],
      ["2025", 13.1],
    ]),
    (row) => String(row[0].raw),
  );
  assert.equal(filled.rows[0][2].value, 12.5, "the published rate stands");
  assert.equal(filled.rows[1][2].value, 13.1, "the gap is filled");
});

test("computed adjustment matches the rate CDC publishes for the same year", () => {
  // The whole point of computing this measure is that it can be read alongside
  // the published one. These are the real 2024 suicide strata from D158, which
  // publishes an age-adjusted rate of 13.732 for that year; if this file ever
  // computes something meaningfully different from that, the series would show
  // a step at the 2024/2025 boundary that is an artefact of the method rather
  // than a change in the data.
  const strata = [
    { ageLabel: "< 1 year", deaths: 0, population: 3615598 },
    { ageLabel: "1-4 years", deaths: 0, population: 14983716 },
    { ageLabel: "5-14 years", deaths: 491, population: 41098826 },
    { ageLabel: "15-24 years", deaths: 5915, population: 44797761 },
    { ageLabel: "25-34 years", deaths: 7993, population: 46453864 },
    { ageLabel: "35-44 years", deaths: 8514, population: 45539224 },
    { ageLabel: "45-54 years", deaths: 7677, population: 40780356 },
    { ageLabel: "55-64 years", deaths: 7749, population: 41661725 },
    { ageLabel: "65-74 years", deaths: 5402, population: 35444962 },
    { ageLabel: "75-84 years", deaths: 3701, population: 19299813 },
    { ageLabel: "85+ years", deaths: 1379, population: 6435143 },
  ];
  const r = ageAdjustedRate(strata);
  assert.ok(r);
  // 13.7372 here against CDC's 13.732: the gap is WONDER rounding the
  // age-specific rates it standardises over, not a difference in method.
  assert.ok(Math.abs(r.rate - 13.732) < 0.01, `got ${r.rate}, CDC publishes 13.732`);
  assert.ok(r.coverage > 0.999, "every age group present");
});

test("a rate is refused when the age groups covering most deaths are missing", () => {
  // Under-45s only. Suicide deaths are spread across the whole adult range, so
  // standardising over the young half and calling it age-adjusted would produce
  // a number far below the real one.
  const youngOnly = [
    { ageLabel: "< 1 year", deaths: 0, population: 3615598 },
    { ageLabel: "1-4 years", deaths: 0, population: 14983716 },
    { ageLabel: "5-14 years", deaths: 491, population: 41098826 },
    { ageLabel: "15-24 years", deaths: 5915, population: 44797761 },
    { ageLabel: "25-34 years", deaths: 7993, population: 46453864 },
    { ageLabel: "35-44 years", deaths: 8514, population: 45539224 },
  ];
  assert.equal(ageAdjustedRate(youngOnly), null);
});
