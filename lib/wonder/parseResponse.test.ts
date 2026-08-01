// Tests for the WONDER XML parser and the request builder.
//
// The XML fixture below is hand-built to the shape parseResponse documents
// (<r> rows of <c> cells; dimension labels in l=, measures in v=, subtotal and
// total values in dt=, rowspan in r=, confidence intervals in a nested <l v=/>)
// rather than captured from the live API, which is unreachable from CI. It
// therefore guards the parser's own contract — row/column alignment, rowspan
// reconstruction, flag detection, total-row handling — not CDC's exact bytes.

import test from "node:test";
import assert from "node:assert/strict";
import type { MeasureKey, QuerySpec } from "./types";
import { parseResponse, extractError } from "./parseResponse";
import { buildRequestXml } from "./buildRequest";

const XML = `<page><data-table>
<r><c l="2018" r="2"/><c l="Female"/><c v="1,000"/><c v="160,000,000"/><c v="0.6"><l v="(0.5, 0.7)"/></c></r>
<r><c l="Male"/><c v="2,000"/><c v="155,000,000"/><c v="1.3"/></r>
<r><c l="2019" r="2"/><c l="Female"/><c v="Suppressed"/><c v="161,000,000"/><c v="Unreliable"/></r>
<r><c l="Male"/><c v="2,500"/><c v="156,000,000"/><c v="1.6"/></r>
<r><c c="1"/><c dt="5,500"/><c dt="632,000,000"/><c dt="0.9"/></r>
</data-table>
<caveat>Counts of 1-9 are suppressed.</caveat></page>`;

const specWith = (measures: MeasureKey[]): QuerySpec => ({
  database: "D158",
  groupBy: ["year", "sex"],
  measures,
  filters: {},
  options: {},
});

test("parseResponse reconstructs rowspan-collapsed dimension labels", () => {
  const table = parseResponse(XML, specWith(["deaths", "population", "crudeRate"]));
  const labels = table.rows.map((r) => [r[0].value, r[1].value]);
  assert.deepEqual(labels, [
    ["2018", "Female"],
    ["2018", "Male"], // year omitted in the XML, carried from the rowspan
    ["2019", "Female"],
    ["2019", "Male"],
    ["Total", "Total"],
  ]);
});

test("parseResponse flags suppressed and unreliable cells and keeps CIs", () => {
  const table = parseResponse(XML, specWith(["deaths", "population", "crudeRate"]));
  assert.equal(table.rows[0][4].ci, "(0.5, 0.7)");
  assert.equal(table.rows[2][2].flag, "suppressed");
  assert.equal(table.rows[2][2].value, null);
  assert.equal(table.rows[2][4].flag, "unreliable");
  assert.equal(table.rows[0][2].value, 1000, "commas stripped from numbers");
});

test("parseResponse marks total rows and excludes them from rowCount", () => {
  const table = parseResponse(XML, specWith(["deaths", "population", "crudeRate"]));
  assert.deepEqual(table.rowIsTotal, [false, false, false, false, true]);
  assert.equal(table.rowCount, 4);
  assert.equal(table.rows[4][2].value, 5500, "total row reads dt=");
  assert.deepEqual(table.caveats, ["Counts of 1-9 are suppressed."]);
});

// WONDER always returns deaths/population/crude rate, so the parser must read
// all three to stay aligned with the response — but the measure checkboxes are
// about what the user wants to see, and used to have no effect at all.
test("parseResponse drops measure columns the spec did not ask for", () => {
  const full = parseResponse(XML, specWith(["deaths", "population", "crudeRate"]));
  assert.deepEqual(
    full.columns.map((c) => c.label),
    ["Year", "Sex", "Deaths", "Population", "Crude Rate"],
  );

  const noPop = parseResponse(XML, specWith(["deaths", "crudeRate"]));
  assert.deepEqual(
    noPop.columns.map((c) => c.label),
    ["Year", "Sex", "Deaths", "Crude Rate"],
  );
  assert.equal(noPop.rows[0][3].value, 0.6, "crude rate kept, population removed");

  // Deaths is always kept: the UI pins its checkbox on and chi-square uses it.
  const deathsOnly = parseResponse(XML, specWith([]));
  assert.deepEqual(
    deathsOnly.columns.map((c) => c.label),
    ["Year", "Sex", "Deaths"],
  );
});

test("every parsed row stays aligned with the column list", () => {
  for (const measures of [
    ["deaths", "population", "crudeRate"],
    ["deaths", "crudeRate"],
    ["deaths"],
  ] as MeasureKey[][]) {
    const table = parseResponse(XML, specWith(measures));
    for (const row of table.rows) {
      assert.equal(
        row.length,
        table.columns.length,
        `row width ${row.length} != ${table.columns.length} for ${measures.join()}`,
      );
    }
  }
});

test("extractError surfaces WONDER error pages", () => {
  assert.equal(
    extractError('<message error="true">Bad request: invalid code</message>'),
    "Bad request: invalid code",
  );
  assert.equal(extractError(XML), null);
});

test("buildRequestXml sends a default for every exposed value variable", () => {
  const xml = buildRequestXml(specWith(["deaths"]));
  // V44 backs the "Race (31 groups)" option; its default was missing before.
  for (const param of ["V_D158.V42", "V_D158.V43", "V_D158.V44", "V_D158.V6"]) {
    assert.ok(xml.includes(`<name>${param}</name>`), `${param} missing from request`);
  }
  assert.ok(xml.includes("<name>B_1</name>"), "group-by slot 1 missing");
});

test("buildRequestXml escapes XML metacharacters in filter codes", () => {
  const xml = buildRequestXml({
    ...specWith(["deaths"]),
    filters: { ucdCause: ['X60 & <script>"'] },
  });
  assert.ok(xml.includes("X60 &amp; &lt;script&gt;&quot;"));
  assert.ok(!xml.includes("<script>"));
});
