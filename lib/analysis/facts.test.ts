import test from "node:test";
import assert from "node:assert/strict";
import type { QuerySpec, ResultCell, ResultColumn, ResultTable } from "../wonder/types";
import { buildFactSheet, keyFigures, renderFactSheet } from "./facts";
import { buildAllowSet, verifyStatements } from "./verify";

const n = (v: number): ResultCell => ({ value: v, raw: String(v) });
const s = (v: string): ResultCell => ({ value: v, raw: v });
const suppressed = (): ResultCell => ({ value: null, raw: "Suppressed", flag: "suppressed" });

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
  return {
    columns,
    rows,
    rowIsTotal: rows.map(() => false),
    caveats: [],
    rowCount: rows.length,
  };
}

const spec = (groupBy: string[]): QuerySpec => ({
  database: "D158",
  groupBy,
  measures: ["deaths", "population", "crudeRate"],
  filters: {},
  options: { ratePer: 100000 },
});

test("marginal rates use summed person-years across population-splitting dimensions", () => {
  // year x sex: collapsing either dimension leaves a valid denominator.
  const table = makeTable(
    [
      { key: "year", label: "Year" },
      { key: "sex", label: "Sex" },
    ],
    ["deaths", "population"],
    [
      [s("2020"), s("Male"), n(300), n(1_000_000)],
      [s("2020"), s("Female"), n(100), n(1_000_000)],
      [s("2021"), s("Male"), n(400), n(1_000_000)],
      [s("2021"), s("Female"), n(100), n(1_000_000)],
    ],
  );
  const f = buildFactSheet(table, spec(["year", "sex"]));

  assert.equal(f.totals.deaths, 900);
  assert.equal(f.totals.population, 4_000_000);
  assert.equal(f.totals.rate, 22.5);

  const sexDim = f.dimensions.find((d) => d.variableKey === "sex");
  assert.ok(sexDim);
  assert.equal(sexDim.ratesValid, true);
  const male = sexDim.categories.find((c) => c.label === "Male");
  // 700 deaths over 2,000,000 person-years = 35 per 100k
  assert.equal(male?.deaths, 700);
  assert.equal(male?.population, 2_000_000);
  assert.equal(male?.rate, 35);
});

test("rates are withheld when collapsing a dimension that repeats the population", () => {
  // year x mechanism: every mechanism row carries the same population, so
  // summing over mechanisms to get a per-year denominator would double count.
  const table = makeTable(
    [
      { key: "year", label: "Year" },
      { key: "injuryMechanism", label: "Injury Mechanism" },
    ],
    ["deaths", "population"],
    [
      [s("2020"), s("Firearm"), n(300), n(1_000_000)],
      [s("2020"), s("Poisoning"), n(200), n(1_000_000)],
      [s("2021"), s("Firearm"), n(350), n(1_000_000)],
      [s("2021"), s("Poisoning"), n(150), n(1_000_000)],
    ],
  );
  const f = buildFactSheet(table, spec(["year", "injuryMechanism"]));

  // Total population is not summable here at all.
  assert.equal(f.totals.population, null);
  assert.equal(f.totals.rate, null);

  const yearDim = f.dimensions.find((d) => d.variableKey === "year");
  assert.equal(yearDim?.ratesValid, false);
  assert.equal(yearDim?.categories[0].rate, null);

  // Collapsing the year dimension IS valid (person-years), so mechanism rates exist.
  const mechDim = f.dimensions.find((d) => d.variableKey === "injuryMechanism");
  assert.equal(mechDim?.ratesValid, true);
  const firearm = mechDim?.categories.find((c) => c.label === "Firearm");
  assert.equal(firearm?.deaths, 650);
  assert.equal(firearm?.population, 2_000_000);
  assert.equal(firearm?.rate, 32.5);
});

test("count-vs-rate divergence is detected", () => {
  const table = makeTable(
    [{ key: "race6", label: "Race" }],
    ["deaths", "population"],
    [
      [s("White"), n(1000), n(100_000_000)], // most deaths, low rate
      [s("Black or African American"), n(400), n(10_000_000)], // fewer deaths, higher rate
    ],
  );
  const f = buildFactSheet(table, spec(["race6"]));
  const d = f.dimensions[0];
  assert.equal(d.countRateDiverges, true);
  assert.equal(d.highestRate?.label, "Black or African American");
  assert.equal(d.highestRate?.rate, 4);
  assert.equal(d.lowestRate?.rate, 1);
  assert.equal(d.rateRatio, 4);
});

test("time facts capture trend, peak and the largest single-period move", () => {
  const table = makeTable(
    [{ key: "year", label: "Year" }],
    ["deaths"],
    [[s("2020"), n(100)], [s("2021"), n(200)], [s("2022"), n(150)]],
  );
  const f = buildFactSheet(table, spec(["year"]));
  assert.ok(f.time);
  assert.equal(f.time.deathsTrend?.first, 100);
  assert.equal(f.time.deathsTrend?.last, 150);
  assert.equal(f.time.deathsTrend?.totalChangePct, 50);
  assert.equal(f.time.peak?.label, "2021");
  assert.equal(f.time.trough?.label, "2020");
  assert.equal(f.time.largestStep?.from, "2020");
  assert.equal(f.time.largestStep?.to, "2021");
  assert.equal(f.time.largestStep?.changePct, 100);
});

test("category labels containing spaces survive the interaction cross-tab", () => {
  const table = makeTable(
    [
      { key: "sex", label: "Sex" },
      { key: "injuryMechanism", label: "Injury Mechanism" },
    ],
    ["deaths"],
    [
      [s("Male"), s("Firearm discharge"), n(900)],
      [s("Male"), s("Poisoning by drugs"), n(100)],
      [s("Female"), s("Firearm discharge"), n(100)],
      [s("Female"), s("Poisoning by drugs"), n(400)],
    ],
  );
  const f = buildFactSheet(table, spec(["sex", "injuryMechanism"]));
  assert.ok(f.interaction);
  const cells = [...f.interaction.overRepresented, ...f.interaction.underRepresented];
  // Multi-word labels must come back intact, not truncated at the first space.
  assert.ok(cells.some((c) => c.colLabel === "Firearm discharge"));
  const maleFirearm = f.interaction.overRepresented.find(
    (c) => c.rowLabel === "Male" && c.colLabel === "Firearm discharge",
  );
  assert.ok(maleFirearm);
  // rowTotal 1000 * colTotal 1000 / grand 1500 = 666.67 expected vs 900 observed
  assert.ok(Math.abs(maleFirearm.expected - 666.667) < 0.01);
  assert.ok(maleFirearm.ratio > 1.3);
});

test("suppressed cells are counted and left out of totals", () => {
  const table = makeTable(
    [{ key: "year", label: "Year" }],
    ["deaths"],
    [[s("2020"), n(100)], [s("2021"), suppressed()]],
  );
  const f = buildFactSheet(table, spec(["year"]));
  assert.equal(f.totals.deaths, 100);
  assert.equal(f.dataQuality.suppressedCells, 1);
});

test("verification accepts fact-sheet figures and derived comparisons", () => {
  const table = makeTable(
    [{ key: "sex", label: "Sex" }],
    ["deaths", "population"],
    [[s("Male"), n(3000), n(1_000_000)], [s("Female"), n(1000), n(1_000_000)]],
  );
  const f = buildFactSheet(table, spec(["sex"]));
  const allow = buildAllowSet(renderFactSheet(f), keyFigures(f));

  const { kept, dropped } = verifyStatements(
    [
      "Male deaths totalled 3,000, three times the 1,000 recorded among females.",
      "The male rate of 300.00 per 100,000 is 3.00 times the female rate.",
      "Deaths among males reached 3,742 over the period.", // invented
    ],
    allow,
  );
  assert.equal(kept.length, 2);
  assert.equal(dropped.length, 1);
  assert.ok(dropped[0].figures.includes("3,742"));
});

test("verification rejects a plausible-looking but wrong percentage", () => {
  const table = makeTable(
    [{ key: "year", label: "Year" }],
    ["deaths"],
    [[s("2020"), n(1000)], [s("2021"), n(1100)]],
  );
  const f = buildFactSheet(table, spec(["year"]));
  const allow = buildAllowSet(renderFactSheet(f), keyFigures(f));
  const { kept, dropped } = verifyStatements(
    ["Deaths rose 10.0% between 2020 and 2021.", "Deaths rose 37.4% between 2020 and 2021."],
    allow,
  );
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 1);
});

test("a year range in the dataset name is not misread as a negative number", () => {
  // "Underlying Cause of Death, 2018-2024" must contribute 2018 AND 2024 to the
  // allow set; a signed regex turned the second into -2024 and then rejected
  // any sentence that mentioned the end year.
  const table = makeTable([{ key: "sex", label: "Sex" }], ["deaths"], [
    [s("Male"), n(100)],
    [s("Female"), n(50)],
  ]);
  const f = buildFactSheet(table, spec(["sex"]));
  const sheet = renderFactSheet(f);
  assert.ok(sheet.includes("2018-2024"), "dataset label should carry the year range");

  const allow = buildAllowSet(sheet, keyFigures(f));
  const { kept, dropped } = verifyStatements(
    ["Male deaths totalled 100 across 2018 through 2024."],
    allow,
  );
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 0);
});

test("an unsigned figure still matches a negative change in the fact sheet", () => {
  const table = makeTable([{ key: "year", label: "Year" }], ["deaths"], [
    [s("2020"), n(1000)],
    [s("2021"), n(800)],
  ]);
  const f = buildFactSheet(table, spec(["year"]));
  const allow = buildAllowSet(renderFactSheet(f), keyFigures(f));
  const { kept } = verifyStatements(["Deaths fell 20.0% between 2020 and 2021."], allow);
  assert.equal(kept.length, 1);
});

test("age-adjusted rates are taken per row and only when unambiguous", () => {
  const oneRowPerCategory = makeTable(
    [{ key: "race6", label: "Race" }],
    ["deaths", "population", "crudeRate", "ageAdjustedRate"],
    [
      [s("White"), n(291969), n(1_760_382_097), n(16.6), n(15.7)],
      [s("More than one race"), n(4963), n(68_475_168), n(7.2), n(8.6)],
    ],
  );
  const f = buildFactSheet(oneRowPerCategory, spec(["race6"]));
  const d = f.dimensions[0];
  assert.equal(d.categories.find((c) => c.label === "White")?.ageAdjustedRate, 15.7);
  assert.equal(d.highestAdjusted?.label, "White");
  assert.equal(d.lowestAdjusted?.label, "More than one race");
  assert.ok(Math.abs((d.adjustedRatio ?? 0) - 15.7 / 8.6) < 1e-9);

  // Two rows per category: an age-adjusted rate cannot be summed or averaged
  // back together, so it must be withheld rather than guessed.
  const twoRows = makeTable(
    [
      { key: "race6", label: "Race" },
      { key: "sex", label: "Sex" },
    ],
    ["deaths", "population", "crudeRate", "ageAdjustedRate"],
    [
      [s("White"), s("Male"), n(200), n(1000), n(20), n(19)],
      [s("White"), s("Female"), n(100), n(1000), n(10), n(11)],
      [s("Asian"), s("Male"), n(50), n(1000), n(5), n(4)],
      [s("Asian"), s("Female"), n(25), n(1000), n(2.5), n(3)],
    ],
  );
  const g = buildFactSheet(twoRows, spec(["race6", "sex"]));
  const raceDim = g.dimensions.find((x) => x.variableKey === "race6");
  assert.equal(raceDim?.categories[0].ageAdjustedRate, null);
  assert.equal(raceDim?.adjustedRatio, null);
});

test("empty placeholder categories are excluded, real zeros are kept", () => {
  const table = makeTable([{ key: "race6", label: "Race" }], ["deaths", "population"], [
    [s("White"), n(1000), n(100_000)],
    [s("Asian"), n(0), n(50_000)],       // genuinely zero deaths — a real finding
    [s("Not Available"), n(0), n(0)],    // WONDER placeholder — no information
  ]);
  const f = buildFactSheet(table, spec(["race6"]));
  const labels = f.dimensions[0].categories.map((c) => c.label);
  assert.ok(labels.includes("White"));
  assert.ok(labels.includes("Asian"), "a real zero-death category is a finding");
  assert.ok(!labels.includes("Not Available"), "0 deaths AND 0 population is a placeholder");
  assert.equal(f.dimensions[0].categoryCount, 2);

  // It must not appear as a CATEGORY the model could write about. It does stay
  // in the verbatim DATA TABLE section, deliberately: that section is the rows
  // as returned, and the numeric verifier builds its allow-set from it.
  const sheet = renderFactSheet(f);
  const breakdown = sheet.slice(0, sheet.indexOf("DATA TABLE"));
  assert.ok(!breakdown.includes("Not Available"), "placeholder must not be listed as a category");
  assert.ok(sheet.includes("Not Available"), "raw rows stay verbatim");
});

test("a suppressed category is kept, since its deaths are hidden not absent", () => {
  const table = makeTable([{ key: "race6", label: "Race" }], ["deaths", "population"], [
    [s("White"), n(1000), n(100_000)],
    [s("Native Hawaiian or Other Pacific Islander"), suppressed(), n(20_000)],
  ]);
  const f = buildFactSheet(table, spec(["race6"]));
  const labels = f.dimensions[0].categories.map((c) => c.label);
  assert.ok(labels.includes("Native Hawaiian or Other Pacific Islander"));
});

test("year-to-date drops trailing months that the data shows are incomplete", () => {
  // Month labels carry the year ("Jan., 2026"), so they only line up across
  // years once reduced to the month itself.
  //
  // Jan and Feb come in near last year's level; March is a fifth of it, which
  // is processing lag rather than a real fall, so it is dropped from BOTH
  // years. How many months go is decided by this comparison, not assumed —
  // cause-specific coding can lag half a year.
  const rows: ResultCell[][] = [];
  const add = (year: string, month: string, deaths: number) =>
    rows.push([s(year), s(`${month}, ${year.slice(0, 4)}`), n(deaths)]);
  const prior = [1000, 1001, 1002];
  const partial = [960, 970, 200];
  for (const [i, m] of ["Jan.", "Feb.", "Mar."].entries()) {
    add("2025 (provisional)", m, prior[i]);
    add("2026 (provisional and partial)", m, partial[i]);
  }

  const table = makeTable(
    [
      { key: "year", label: "Year" },
      { key: "month", label: "Month" },
    ],
    ["deaths"],
    rows,
  );
  const f = buildFactSheet(table, spec(["year", "month"]));
  assert.ok(f.ytd);

  assert.deepEqual(f.ytd.droppedMonths, ["Mar"]);
  assert.deepEqual(f.ytd.comparedMonths, ["Jan", "Feb"]);
  assert.equal(f.ytd.previous.deaths, 1000 + 1001);
  assert.equal(f.ytd.current.deaths, 960 + 970);
  assert.ok(Math.abs((f.ytd.changePct ?? 0) - ((1930 - 2001) / 2001) * 100) < 1e-9);
});

test("a month running close to last year is kept, not dropped for being last", () => {
  // The old rule always discarded the newest month. When the newest month is
  // in fact complete, that threw away a month of real data.
  const rows: ResultCell[][] = [];
  const add = (year: string, month: string, deaths: number) =>
    rows.push([s(year), s(`${month}, 2020`), n(deaths)]);
  for (const [i, m] of ["Jan.", "Feb.", "Mar."].entries()) {
    add("2025 (provisional)", m, 1000 + i);
    add("2026 (provisional and partial)", m, 980 + i);
  }
  const table = makeTable(
    [
      { key: "year", label: "Year" },
      { key: "month", label: "Month" },
    ],
    ["deaths"],
    rows,
  );
  const f = buildFactSheet(table, spec(["year", "month"]));
  assert.ok(f.ytd);
  assert.deepEqual(f.ytd.comparedMonths, ["Jan", "Feb", "Mar"]);
  assert.deepEqual(f.ytd.droppedMonths, []);
});

test("no year-to-date when the lag reaches back past every month available", () => {
  // Suicide coding ran roughly six months behind: only the first month or two
  // of the partial year were usable. If nothing is usable, saying nothing is
  // the right answer.
  const rows: ResultCell[][] = [];
  const add = (year: string, month: string, deaths: number) =>
    rows.push([s(year), s(`${month}, 2020`), n(deaths)]);
  for (const [i, m] of ["Jan.", "Feb.", "Mar."].entries()) {
    add("2025 (provisional)", m, 4000 + i);
    add("2026 (provisional and partial)", m, 100 + i);
  }
  const table = makeTable(
    [
      { key: "year", label: "Year" },
      { key: "month", label: "Month" },
    ],
    ["deaths"],
    rows,
  );
  assert.equal(buildFactSheet(table, spec(["year", "month"])).ytd, undefined);
});

test("a year missing one of the compared months is left out of the comparison", () => {
  const rows: ResultCell[][] = [];
  const add = (year: string, month: string, deaths: number) =>
    rows.push([s(year), s(`${month}, 2020`), n(deaths)]);
  // 2024 has no February, so including it would understate that year purely
  // because a month is absent.
  add("2024", "Jan.", 100);
  add("2024", "Mar.", 100);
  for (const [i, m] of ["Jan.", "Feb.", "Mar."].entries()) {
    add("2025 (provisional)", m, 200 + i);
    add("2026 (provisional and partial)", m, 300 + i);
  }
  const table = makeTable(
    [
      { key: "year", label: "Year" },
      { key: "month", label: "Month" },
    ],
    ["deaths"],
    rows,
  );
  const f = buildFactSheet(table, spec(["year", "month"]));
  assert.ok(f.ytd);
  assert.deepEqual(
    f.ytd.series.map((p) => p.label),
    ["2025 (provisional)", "2026 (provisional and partial)"],
  );
});

test("no year-to-date without a partial period or without month detail", () => {
  const yearOnly = makeTable([{ key: "year", label: "Year" }], ["deaths"], [
    [s("2025 (provisional)"), n(10)],
    [s("2026 (provisional and partial)"), n(5)],
  ]);
  assert.equal(buildFactSheet(yearOnly, spec(["year"])).ytd, undefined);

  const complete = makeTable(
    [
      { key: "year", label: "Year" },
      { key: "month", label: "Month" },
    ],
    ["deaths"],
    [
      [s("2023"), s("Jan., 2023"), n(10)],
      [s("2024"), s("Jan., 2024"), n(11)],
    ],
  );
  assert.equal(buildFactSheet(complete, spec(["year", "month"])).ytd, undefined);
});

test("a partial period is not eligible to be the lowest rate", () => {
  // Observed on the combined 1999-2026 series: two months of 2026 gave a crude
  // rate of 2.45 against 14.84 in 2022, so the fact sheet offered a 6.07x
  // "highest-to-lowest" ratio whose confidence interval excluded 1 — a
  // statistically significant finding about how far into the year it is. The
  // model then wrote it up, and the verifier passed it, because every figure
  // in it was real.
  const t = makeTable(
    [{ key: "year", label: "Year" }],
    ["deaths", "population", "crudeRate"],
    [
      [s("2023"), n(49_000), n(334_000_000), n(14.67)],
      [s("2024"), n(48_824), n(340_000_000), n(14.36)],
      [s("2025 (provisional)"), n(49_069), n(340_000_000), n(14.43)],
      [s("2026 (provisional and partial)"), n(8_316), n(340_000_000), n(2.45)],
    ],
  );
  const f = buildFactSheet(t, spec(["year"]));
  const dim = f.dimensions[0];
  assert.ok(dim.lowestRate, "there is still a lowest rate");
  assert.ok(
    !/partial/i.test(dim.lowestRate.label),
    `lowest rate was the partial period: ${dim.lowestRate.label}`,
  );
  assert.equal(dim.lowestRate.label, "2024");
  assert.equal(dim.highestRate?.label, "2023");
  // 14.67 / 14.36, not 14.67 / 2.45.
  assert.ok(dim.rateRatio !== null && dim.rateRatio < 1.1, `ratio was ${dim.rateRatio}`);

  // And the rendered sheet must not offer the partial period as a comparator.
  const sheet = renderFactSheet(f);
  const rateLines = sheet.split("\n").filter((l) => /lowest:/.test(l));
  assert.ok(rateLines.length > 0);
  for (const line of rateLines) {
    assert.ok(!/partial/i.test(line), `partial period offered as a comparator: ${line}`);
  }
});

test("the partial period's own count is still reported", () => {
  // Excluding it from RATE comparisons must not delete it: 8,316 deaths in the
  // months so far is a true count and the reader should still see it.
  const t = makeTable(
    [{ key: "year", label: "Year" }],
    ["deaths", "population", "crudeRate"],
    [
      [s("2024"), n(48_824), n(340_000_000), n(14.36)],
      [s("2026 (provisional and partial)"), n(8_316), n(340_000_000), n(2.45)],
    ],
  );
  const sheet = renderFactSheet(buildFactSheet(t, spec(["year"])));
  assert.match(sheet, /8,316/);
});

test("a result made up entirely of partial periods still renders", () => {
  // Querying the current year alone leaves nothing comparable behind. The
  // sheet must lose the rate comparison, not throw or emit a half-built line.
  const t = makeTable(
    [{ key: "year", label: "Year" }],
    ["deaths", "population", "crudeRate"],
    [[s("2026 (provisional and partial)"), n(8_316), n(340_000_000), n(2.45)]],
  );
  const f = buildFactSheet(t, spec(["year"]));
  assert.equal(f.dimensions[0].highestRate, undefined);
  assert.equal(f.dimensions[0].lowestRate, undefined);
  assert.equal(f.dimensions[0].rateRatio, null);
  const sheet = renderFactSheet(f);
  assert.match(sheet, /8,316/, "the count survives");
  assert.ok(!/lowest:/.test(sheet), "no comparison is offered");
});
