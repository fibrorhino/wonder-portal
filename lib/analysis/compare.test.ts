import test from "node:test";
import assert from "node:assert/strict";
import type { ResultCell, ResultColumn, ResultTable } from "../wonder/types";
import { compareTables } from "./compare";

const n = (v: number): ResultCell => ({ value: v, raw: String(v) });
const s = (v: string): ResultCell => ({ value: v, raw: v });

function makeTable(
  dims: { key: string; label: string }[],
  measures: ("deaths" | "population" | "crudeRate" | "ageAdjustedRate")[],
  rows: ResultCell[][],
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
      measureKey: m,
    })),
  ];
  return { columns, rows, rowIsTotal: rows.map(() => false), caveats: [], rowCount: rows.length };
}

const byYear = (a: number, b: number, c: number) =>
  makeTable([{ key: "year", label: "Year" }], ["deaths"], [
    [s("2022"), n(a)],
    [s("2023"), n(b)],
    [s("2024"), n(c)],
  ]);

test("aligned comparison diffs matching rows and totals", () => {
  const cmp = compareTables(byYear(100, 200, 300), byYear(150, 180, 600));
  assert.ok(cmp);
  assert.equal(cmp.aligned, true);
  assert.equal(cmp.measureKey, "deaths");
  assert.equal(cmp.totals.a, 600);
  assert.equal(cmp.totals.b, 930);
  assert.equal(cmp.totals.diff, 330);
  assert.ok(Math.abs((cmp.totals.pctChange ?? 0) - 55) < 1e-9);

  // Sorted by the size of the difference, so 2024 (+300) leads.
  assert.deepEqual(cmp.rows[0].labels, ["2024"]);
  assert.equal(cmp.rows[0].diff, 300);
  assert.equal(cmp.rows[0].pctChange, 100);

  const y2023 = cmp.rows.find((r) => r.labels[0] === "2023");
  assert.equal(y2023?.diff, -20);
  assert.equal(y2023?.pctChange, -10);
});

test("rows present on only one side are kept but not differenced", () => {
  const a = makeTable([{ key: "year", label: "Year" }], ["deaths"], [
    [s("2022"), n(100)],
    [s("2023"), n(200)],
  ]);
  const b = makeTable([{ key: "year", label: "Year" }], ["deaths"], [
    [s("2023"), n(200)],
    [s("2024"), n(50)],
  ]);
  const cmp = compareTables(a, b);
  assert.ok(cmp);
  assert.deepEqual(cmp.onlyInA, ["2022"]);
  assert.deepEqual(cmp.onlyInB, ["2024"]);
  const only = cmp.rows.find((r) => r.labels[0] === "2022");
  assert.equal(only?.b, null);
  assert.equal(only?.diff, null);
});

test("different groupings compare totals only, with an explanation", () => {
  const a = byYear(100, 200, 300);
  const b = makeTable([{ key: "sex", label: "Sex" }], ["deaths"], [
    [s("Male"), n(500)],
    [s("Female"), n(100)],
  ]);
  const cmp = compareTables(a, b);
  assert.ok(cmp);
  assert.equal(cmp.aligned, false);
  assert.equal(cmp.rows.length, 0);
  assert.equal(cmp.totals.a, 600);
  assert.equal(cmp.totals.b, 600);
  assert.match(cmp.note ?? "", /group differently/);
});

test("rates are never totalled, since adding rates is meaningless", () => {
  const mk = (x: number, y: number) =>
    makeTable([{ key: "sex", label: "Sex" }], ["deaths", "crudeRate"], [
      [s("Male"), n(100), n(x)],
      [s("Female"), n(50), n(y)],
    ]);
  const cmp = compareTables(mk(20, 6), mk(25, 5), "crudeRate");
  assert.ok(cmp);
  assert.equal(cmp.measureKey, "crudeRate");
  assert.equal(cmp.totals.a, null);
  assert.equal(cmp.totals.b, null);
  const male = cmp.rows.find((r) => r.labels[0] === "Male");
  assert.equal(male?.diff, 5);
});

test("comparison falls back to a measure both results carry", () => {
  const a = makeTable([{ key: "sex", label: "Sex" }], ["deaths", "crudeRate"], [
    [s("Male"), n(100), n(20)],
  ]);
  const b = makeTable([{ key: "sex", label: "Sex" }], ["deaths"], [[s("Male"), n(120)]]);
  // crudeRate was asked for but B does not have it, so deaths is used instead.
  const cmp = compareTables(a, b, "crudeRate");
  assert.ok(cmp);
  assert.equal(cmp.measureKey, "deaths");
  assert.equal(cmp.rows[0].diff, 20);
});
