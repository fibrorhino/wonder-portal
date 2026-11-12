// Tests for the WONDER XML parser and the request builder.
//
// The first XML fixture below is hand-built to the shape parseResponse
// documents (<r> rows of <c> cells; dimension labels in l=, measures in v=,
// subtotal and total values in dt=, rowspan in r=, confidence intervals in a
// nested <l v=/>). It guards the parser's own contract: row/column alignment,
// rowspan reconstruction, flag detection, total-row handling. CDC's exact bytes
// are covered separately, by the captured responses at the end of this file.

import test from "node:test";
import assert from "node:assert/strict";
import type { MeasureKey, QuerySpec } from "./types";
import {
  decodeBody,
  extractCaveats,
  extractError,
  parseResponse,
  returnedMeasures,
} from "./parseResponse";
import { ageAdjustedBlocker, buildRequestXml, measureColumns } from "./buildRequest";
import { DATABASES } from "./db/registry";
import { D158_RESPONSE_XML } from "./fixtures/d158Response";
import { D176_RESPONSE_XML } from "./fixtures/d176Response";

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

// ---------------------------------------------------------------------------
// Characterisation against real payloads (lib/wonder/fixtures).
//
// The hand-built fixture above could not catch this: it has one tidy <caveat>,
// where a real response has around forty, most of them definitions that do not
// apply to the result. The site showed the definitions' rule expressions
// ("wonder:cmf-5()") as CDC's caveats and dropped the real ones.
// ---------------------------------------------------------------------------

const realSpec = (database: string, measures: MeasureKey[]): QuerySpec => ({
  database,
  groupBy: ["year"],
  measures,
  filters: { injuryIntent: ["2"] },
  options: {},
});

test("real D158 response: only the caveats that apply, as readable text", () => {
  const table = parseResponse(
    D158_RESPONSE_XML,
    realSpec("D158", ["deaths", "population", "crudeRate", "ageAdjustedRate"]),
  );
  assert.equal(table.caveats.length, 8, "the eight in <response><caveats>, not the definitions");
  for (const c of table.caveats) {
    assert.ok(!/wonder:[a-z0-9-]+\(/.test(c), `rule expression shown as a caveat: ${c}`);
    assert.ok(!c.includes("]]>") && !c.includes("CDATA"), `CDATA wrapper leaked: ${c}`);
    assert.ok(!/<[a-z/]/i.test(c), `markup leaked: ${c}`);
  }
  // No markup inside the CDATA: the whole text used to vanish.
  assert.ok(
    table.caveats.includes(
      "Deaths for persons of unknown age are included in counts and crude rates, but are not included in age-adjusted rates.",
    ),
  );
  // A link inside: only "More information. ]]>" used to survive.
  assert.ok(
    table.caveats.includes(
      "The method used to calculate age-adjusted rates is documented here: More information. " +
        "(https://wonder.cdc.gov/wonder/help/ucd-expanded.html#Age-Adjusted%20Rates)",
    ),
  );
});

test("real D158 response: figures and confidence intervals", () => {
  const table = parseResponse(
    D158_RESPONSE_XML,
    realSpec("D158", ["deaths", "population", "crudeRate", "ageAdjustedRate"]),
  );
  assert.equal(table.rowCount, 7);
  const y2018 = table.rows[0];
  assert.deepEqual(
    y2018.map((c) => c.value),
    ["2018", 48344, 327167434, 14.777, 14.245],
  );
  assert.equal(y2018[3].ci, "(14.645 - 14.908)");
  // CDC sends this label as "2024 " with a trailing space.
  assert.equal(table.rows[6][0].value, "2024");
  assert.deepEqual(table.rowIsTotal, [false, false, false, false, false, false, false, true]);
  assert.equal(table.rows[7][1].value, 337633);
});

test("real D176 response: provisional labels and the data-through caveat", () => {
  const table = parseResponse(
    D176_RESPONSE_XML,
    realSpec("D176", ["deaths", "population", "crudeRate"]),
  );
  const years = table.rows.filter((_, i) => !table.rowIsTotal[i]).map((r) => r[0].value);
  assert.deepEqual(years.slice(-2), ["2025 (provisional)", "2026 (provisional and partial)"]);
  // The only statement of how far the provisional data runs. It has no markup
  // inside its CDATA, so it was one of the caveats that disappeared entirely.
  assert.ok(
    table.caveats.includes("Deaths occurring through October 31, 2026 as of November 8, 2026."),
    table.caveats.join(" | "),
  );
  assert.equal(table.caveats.length, 7);
});

test("a document with no <caveats> block still skips definitions", () => {
  const xml =
    '<page><dataset><caveat code="D1.C1"><text evaluate="false"><![CDATA[Never applies.]]></text>' +
    "<rule>wonder:cmf-5()</rule></caveat></dataset>" +
    "<caveat><![CDATA[Applies &amp; is kept.]]></caveat></page>";
  assert.deepEqual(extractCaveats(xml), ["Applies & is kept."]);
});

// ---------------------------------------------------------------------------
// The age-adjusted rate CDC will not publish.
//
// CDC's reply to a "Race (15 groups)" query with the default measures, word
// for word, with HTTP 500: "Age Adjusted Rates are not available when values
// are selected for Single Race 15 or Single/Multi Race 31 in section 3, or if
// these variables appear in Group Results By list in section 1. Uncheck the
// Age Adjusted Rates checkbox." (2026-11-11.)
// ---------------------------------------------------------------------------

const ALL_FOUR: MeasureKey[] = ["deaths", "population", "crudeRate", "ageAdjustedRate"];
const paramValue = (xml: string, name: string) =>
  xml.match(new RegExp(`<name>${name}</name>\\n<value>([^<]*)</value>`))?.[1];

test("the detailed race classifications never ask for an age-adjusted rate", () => {
  for (const key of ["race15", "race31"]) {
    const grouped: QuerySpec = {
      database: "D158",
      groupBy: [key],
      measures: ALL_FOUR,
      filters: {},
      options: {},
    };
    const xml = buildRequestXml(grouped);
    assert.ok(!xml.includes("<name>M_4</name>"), `${key}: M_4 was requested`);
    assert.equal(paramValue(xml, "O_aar"), "aar_none", key);
    assert.deepEqual(measureColumns(grouped), ["deaths", "population", "crudeRate"], key);
    assert.match(ageAdjustedBlocker(grouped) ?? "", /Race/, key);
  }
});

test("filtering on a detailed race classification blocks it too", () => {
  // CDC's message names both cases: "values are selected ... in section 3".
  const filtered: QuerySpec = {
    database: "D158",
    groupBy: ["year"],
    measures: ALL_FOUR,
    filters: { race15: ["1"] },
    options: {},
  };
  assert.ok(!buildRequestXml(filtered).includes("<name>M_4</name>"));
  assert.deepEqual(measureColumns(filtered), ["deaths", "population", "crudeRate"]);
  // An empty filter is not a selection.
  assert.equal(ageAdjustedBlocker({ ...filtered, filters: { race15: [] } }), null);
});

test("the six-group race classification still gets its age-adjusted rate", () => {
  const spec: QuerySpec = {
    database: "D158",
    groupBy: ["race6"],
    measures: ALL_FOUR,
    filters: {},
    options: {},
  };
  assert.equal(ageAdjustedBlocker(spec), null);
  const xml = buildRequestXml(spec);
  assert.ok(xml.includes("<name>M_4</name>"));
  assert.equal(paramValue(xml, "O_aar"), "aar_std");
  assert.deepEqual(measureColumns(spec), ALL_FOUR);
});

test("the builder and the parser agree on the age-adjusted column for every variable", () => {
  // If one asks for the column and the other does not expect it, every measure
  // lands one column to the side with no error anywhere.
  for (const db of DATABASES) {
    if (db.composite) continue;
    for (const v of db.variables.filter((x) => x.canGroup)) {
      const spec: QuerySpec = {
        database: db.id,
        groupBy: [v.key],
        measures: ALL_FOUR,
        filters: {},
        options: {},
      };
      const asked = buildRequestXml(spec).includes("<name>M_4</name>");
      const expected = measureColumns(spec).includes("ageAdjustedRate");
      assert.equal(asked, expected, `${db.id} ${v.key}`);
    }
  }
});

test("an age filter CDC will not adjust over drops the age-adjusted rate", () => {
  const base: QuerySpec = {
    database: "D158",
    groupBy: ["year"],
    measures: ALL_FOUR,
    filters: { injuryIntent: ["2"] },
    options: {},
  };
  // CDC: "Standard age-adjusted rates are only available for the ten-year age groups."
  const fiveYear = { ...base, filters: { ...base.filters, ageFive: ["10-14", "15-19", "20-24"] } };
  assert.match(ageAdjustedBlocker(fiveYear) ?? "", /ten-year age groups/);
  assert.ok(!buildRequestXml(fiveYear).includes("<name>M_4</name>"));
  assert.deepEqual(measureColumns(fiveYear), ["deaths", "population", "crudeRate"]);

  // CDC: "Please select more than one age group when calculating age-adjusted rates."
  const oneGroup = { ...base, filters: { ...base.filters, ageTen: ["15-24"] } };
  assert.match(ageAdjustedBlocker(oneGroup) ?? "", /more than one age group/);
  assert.ok(!buildRequestXml(oneGroup).includes("<name>M_4</name>"));

  // Two or more ten-year groups are fine; verified against the live API.
  const twoGroups = { ...base, filters: { ...base.filters, ageTen: ["15-24", "25-34"] } };
  assert.equal(ageAdjustedBlocker(twoGroups), null);
  assert.ok(buildRequestXml(twoGroups).includes("<name>M_4</name>"));

  // The classic file obeys the same rule.
  assert.match(
    ageAdjustedBlocker({ ...fiveYear, database: "D76" }) ?? "",
    /ten-year age groups/,
  );
});

// ---------------------------------------------------------------------------
// What CDC says it returned.
// ---------------------------------------------------------------------------

// Excerpt of the real response to "provisional file, grouped by Race (15
// groups)", 2026-11-11. Three measures were asked for and one came back, with
// no placeholder cells and no caveat to say so.
const RACE15_PROVISIONAL = `<page><response>
<measure-selections-all>
	<measure code="D176.M1"/>
</measure-selections-all>
<data-table show-all-labels="false">
<r><c l="White"/><c v="22,886,146"/></r>
<r><c l="Black"/><c v="3,513,890"/></r>
<r><c c="1"/><c dt="27,571,117"/></r>
</data-table>
</response></page>`;

test("a measure CDC did not return gets no column", () => {
  const spec: QuerySpec = {
    database: "D176",
    groupBy: ["race15"],
    measures: ["deaths", "population", "crudeRate"],
    filters: {},
    options: {},
  };
  assert.deepEqual(returnedMeasures(RACE15_PROVISIONAL), ["deaths"]);
  const table = parseResponse(RACE15_PROVISIONAL, spec);
  // Was: Deaths, Population, Crude Rate, with the last two columns blank.
  assert.deepEqual(
    table.columns.map((c) => c.key),
    ["dim_race15", "m_deaths"],
  );
  assert.deepEqual(
    table.rows.map((r) => r.map((c) => c.value)),
    [
      ["White", 22886146],
      ["Black", 3513890],
      ["Total", 27571117],
    ],
  );
});

test("a measure dropped from the middle does not shift the ones after it", () => {
  // Not something CDC has been seen to do, which is the point: if it ever
  // does, reading cells by the position they were ASKED for would file the
  // crude rate under Population.
  const xml = `<page><response><measure-selections-all>
<measure code="D158.M1"/><measure code="D158.M3"/><measure code="D158.M9"/><measure code="D158.M4"/>
</measure-selections-all><data-table>
<r><c l="2020"/><c v="100"/><c v="1.5"/><c v="0.2%"/><c v="1.4"/></r>
</data-table></response></page>`;
  const table = parseResponse(xml, realSpec("D158", ALL_FOUR));
  assert.deepEqual(
    table.columns.map((c) => c.measureKey ?? c.key),
    ["dim_year", "deaths", "crudeRate", "ageAdjustedRate"],
  );
  // M9 (percent of total) has no column here, and its cell is stepped over.
  assert.deepEqual(
    table.rows[0].map((c) => c.value),
    ["2020", 100, 1.5, 1.4],
  );
});

test("the real responses declare the measures they carry", () => {
  assert.deepEqual(returnedMeasures(D158_RESPONSE_XML), ALL_FOUR);
  assert.deepEqual(returnedMeasures(D176_RESPONSE_XML), ["deaths", "population", "crudeRate"]);
  assert.equal(returnedMeasures(XML), null, "the hand-built fixture does not say");
});

// ---------------------------------------------------------------------------
// CDC's error pages. Both bodies are real, 2026-11-11, and arrive with HTTP 500.
// ---------------------------------------------------------------------------

test("an error message wrapped in CDATA is still read", () => {
  // The whole message used to be stripped as if it were one tag, leaving "",
  // which the route took to mean CDC had said nothing.
  const xml = `<?xml version="1.0"?>
<page>
<platform>prod</platform>
<title>Processing Error</title>
<message><![CDATA[Invalid 'Year/Month' codes were found: '2027'. Check the Finder Tool for valid Year/Month codes.]]></message>
</page>`;
  assert.equal(
    extractError(xml),
    "Invalid 'Year/Month' codes were found: '2027'. Check the Finder Tool for valid Year/Month codes.",
  );
});

test("CDC's help-link tokens are not shown to the visitor", () => {
  const xml = `<page><title>Processing Error</title>
<message>Please select more than one age group when calculating age-adjusted rates. #Age-Adjusted Rates Hints#</message>
</page>`;
  assert.equal(
    extractError(xml),
    "Please select more than one age group when calculating age-adjusted rates.",
  );
});

test("a body is decoded in the character set it declares", () => {
  // 0xA7 is the section sign in ISO-8859-1 and an invalid byte in UTF-8.
  const latin1 = new Uint8Array([0x31, 0x38, 0x20, 0x55, 0x2e, 0x53, 0x2e, 0x43, 0x2e, 0x20, 0xa7, 0x20, 0x31]);
  assert.equal(decodeBody(latin1, "text/html;charset=ISO-8859-1"), "18 U.S.C. § 1");
  assert.ok(decodeBody(latin1, null).includes("�"), "undeclared falls back to UTF-8");
  const utf8 = new TextEncoder().encode("Ménière");
  assert.equal(decodeBody(utf8, "text/xml; charset=utf-8"), "Ménière");
  assert.equal(decodeBody(utf8, "text/xml; charset=not-a-real-charset"), "Ménière");
});
