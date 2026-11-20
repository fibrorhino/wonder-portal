import test from "node:test";
import assert from "node:assert/strict";
import type { ResultCell, ResultColumn, ResultTable } from "./wonder/types";
import { collapseRows, monthOfYear } from "./chartData";

const s = (v: string): ResultCell => ({ value: v, raw: v });
const n = (v: number, ci?: string): ResultCell => ({ value: v, raw: String(v), ...(ci ? { ci } : {}) });

function table(dims: { key: string; label: string }[], rows: ResultCell[][]): ResultTable {
  const columns: ResultColumn[] = [
    ...dims.map((d) => ({ key: `dim_${d.key}`, label: d.label, kind: "dimension" as const, variableKey: d.key })),
    { key: "m_deaths", label: "Deaths", kind: "measure", measureKey: "deaths" },
    { key: "m_population", label: "Population", kind: "measure", measureKey: "population" },
    { key: "m_crudeRate", label: "Crude Rate", kind: "measure", measureKey: "crudeRate" },
    { key: "m_ageAdjustedRate", label: "Age-Adjusted Rate", kind: "measure", measureKey: "ageAdjustedRate" },
  ];
  return { columns, rows, rowIsTotal: rows.map(() => false), caveats: [], rowCount: rows.length };
}

// year x sex x race: 2 x 2 x 2, with populations that genuinely split.
const YSR = table(
  [
    { key: "year", label: "Year" },
    { key: "sex", label: "Sex" },
    { key: "race6", label: "Race" },
  ],
  [
    [s("2020"), s("Female"), s("Black"), n(10), n(1_000_000), n(1.0), n(1.1)],
    [s("2020"), s("Female"), s("White"), n(90), n(3_000_000), n(3.0), n(2.9)],
    [s("2020"), s("Male"), s("Black"), n(40), n(1_000_000), n(4.0), n(4.2)],
    [s("2020"), s("Male"), s("White"), n(360), n(3_000_000), n(12.0), n(11.5)],
    [s("2021"), s("Female"), s("Black"), n(12), n(1_000_000), n(1.2), n(1.3)],
    [s("2021"), s("Female"), s("White"), n(96), n(3_000_000), n(3.2), n(3.1)],
    [s("2021"), s("Male"), s("Black"), n(44), n(1_000_000), n(4.4), n(4.5)],
    [s("2021"), s("Male"), s("White"), n(372), n(3_000_000), n(12.4), n(12.0)],
  ],
);
const [YEAR, SEX, RACE, DEATHS, POP, CRUDE, AAR] = [0, 1, 2, 3, 4, 5, 6];

const values = (r: ReturnType<typeof collapseRows>, idx: number) =>
  r.ok ? r.rows.map((row) => [row[YEAR].raw, row[SEX].raw, row[idx].value]) : r.reason;

test("a third grouping variable is combined, not plotted into the same line", () => {
  // Before: every year carried two points per sex (one per race), which the
  // line chart joined into a spike.
  const r = collapseRows(YSR, [YEAR, SEX], DEATHS);
  assert.ok(r.ok);
  assert.deepEqual(values(r, DEATHS), [
    ["2020", "Female", 100],
    ["2020", "Male", 400],
    ["2021", "Female", 108],
    ["2021", "Male", 416],
  ]);
  assert.deepEqual(r.collapsed, [RACE]);
});

test("a combined crude rate is rebuilt from deaths and population, never averaged", () => {
  const r = collapseRows(YSR, [YEAR, SEX], CRUDE);
  assert.ok(r.ok);
  // Female 2020: 100 deaths / 4,000,000 = 2.5 per 100,000. The mean of the
  // two race rates would be 2.0, and their sum 4.0: both wrong.
  assert.equal(r.rows[0][CRUDE].value, 2.5);
  assert.equal(r.rows[1][CRUDE].value, 10);
  assert.equal(r.rows[0][CRUDE].ci, undefined, "no CDC interval for a combined value");
});

test("population adds up across variables that divide it", () => {
  const r = collapseRows(YSR, [YEAR], POP);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.rows.map((row) => row[POP].value), [8_000_000, 8_000_000]);
});

test("an age-adjusted rate is never combined", () => {
  const r = collapseRows(YSR, [YEAR, SEX], AAR);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.reason : "", /cannot be combined across Race/);
  assert.deepEqual(!r.ok ? r.names : [], ["Race"]);
});

test("choosing one value of the extra variable keeps CDC's own cell", () => {
  const r = collapseRows(YSR, [YEAR, SEX], AAR, { [RACE]: "White" });
  assert.ok(r.ok);
  assert.deepEqual(values(r, AAR), [
    ["2020", "Female", 2.9],
    ["2020", "Male", 11.5],
    ["2021", "Female", 3.1],
    ["2021", "Male", 12.0],
  ]);
});

test("with nothing left to combine, rows pass through untouched", () => {
  const withCi = table([{ key: "year", label: "Year" }], [
    [s("2020"), n(5), n(100), n(5000, "(1 - 2)"), n(4900)],
  ]);
  const r = collapseRows(withCi, [0], 3);
  assert.ok(r.ok);
  assert.equal(r.ok && r.rows[0][3].ci, "(1 - 2)");
  assert.deepEqual(r.collapsed, []);
});

test("grouping by cause repeats the population, so it is taken once", () => {
  // Every mechanism row carries the whole population.
  const ym = table(
    [
      { key: "year", label: "Year" },
      { key: "injuryMechanism", label: "Mechanism" },
    ],
    [
      [s("2020"), s("Firearm"), n(240), n(10_000_000), n(2.4), n(2.3)],
      [s("2020"), s("Poisoning"), n(60), n(10_000_000), n(0.6), n(0.6)],
    ],
  );
  const pop = collapseRows(ym, [0], 3);
  assert.ok(pop.ok);
  assert.equal(pop.ok && pop.rows[0][3].value, 10_000_000, "not 20,000,000");
  const rate = collapseRows(ym, [0], 4);
  assert.equal(rate.ok && rate.rows[0][4].value, 3, "300 deaths per 10,000,000");
});

test("a population that is both split and repeated is refused", () => {
  const mixed = table(
    [
      { key: "year", label: "Year" },
      { key: "sex", label: "Sex" },
      { key: "injuryMechanism", label: "Mechanism" },
    ],
    [
      [s("2020"), s("Female"), s("Firearm"), n(40), n(5_000_000), n(0.8), n(0.8)],
      [s("2020"), s("Female"), s("Poisoning"), n(30), n(5_000_000), n(0.6), n(0.6)],
      [s("2020"), s("Male"), s("Firearm"), n(200), n(5_000_000), n(4.0), n(4.0)],
      [s("2020"), s("Male"), s("Poisoning"), n(30), n(5_000_000), n(0.6), n(0.6)],
    ],
  );
  const r = collapseRows(mixed, [0], 5);
  assert.equal(r.ok, false);
  // Deaths are still fine to add.
  const d = collapseRows(mixed, [0], 3);
  assert.equal(d.ok && d.rows[0][3].value, 300);
});

test("suppressed cells drop out of a sum rather than count as zero or poison it", () => {
  const sup = table(
    [
      { key: "year", label: "Year" },
      { key: "race6", label: "Race" },
    ],
    [
      [s("2020"), s("A"), { value: null, raw: "Suppressed", flag: "suppressed" }, n(100), n(0), n(0)],
      [s("2020"), s("B"), n(50), n(900), n(0), n(0)],
    ],
  );
  const r = collapseRows(sup, [0], 2);
  assert.equal(r.ok && r.rows[0][2].value, 50);
});

test("month labels lose their year when the year is shown elsewhere", () => {
  assert.equal(monthOfYear("Jan., 2018"), "Jan");
  assert.equal(monthOfYear("Feb., 2026 (provisional and partial)"), "Feb");
  // The final and provisional files spell May differently; one category.
  assert.equal(monthOfYear("May, 2022"), "May");
  assert.equal(monthOfYear("May., 2026 (provisional)"), "May");
  assert.equal(monthOfYear("Sep., 2019"), "Sep");
  assert.equal(monthOfYear("Unknown"), "Unknown");
});
