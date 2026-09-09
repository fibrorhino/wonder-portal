// Characterisation tests: the exact bytes D158 puts on the wire.
//
// These exist to make the multi-database refactor safe. They do not assert that
// the request is *correct* — they assert it is *unchanged*. Every parameter
// here was verified against the live CDC API over months of trial and error,
// and a silent change to any of it would produce a query that either errors or,
// far worse, quietly returns different data.
//
// If a change to this file's expectations is ever needed, that is a signal to
// stop and re-verify against the live API, not to update the snapshot.

import test from "node:test";
import assert from "node:assert/strict";
import type { QuerySpec } from "./types";
import { buildRequestXml, measureColumns } from "./buildRequest";

const spec = (over: Partial<QuerySpec> = {}): QuerySpec => ({
  database: "D158",
  groupBy: ["year"],
  measures: ["deaths", "population", "crudeRate", "ageAdjustedRate"],
  filters: {},
  options: { showTotals: true, showZeros: true, showSuppressed: true, ratePer: 100000 },
  ...over,
});

/** Parameter name -> values, parsed back out of the generated XML. */
function params(xml: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const blocks = xml.match(/<parameter>[\s\S]*?<\/parameter>/g) ?? [];
  for (const b of blocks) {
    const name = /<name>([\s\S]*?)<\/name>/.exec(b)?.[1] ?? "";
    const values = [...b.matchAll(/<value>([\s\S]*?)<\/value>/g)].map((m) => m[1]);
    out.set(name, values);
  }
  return out;
}

// The representative queries: one of each shape the app can produce.
const CASES: { name: string; spec: QuerySpec }[] = [
  { name: "default (year, all causes)", spec: spec() },
  {
    name: "suicide by year and mechanism",
    spec: spec({ groupBy: ["year", "injuryMechanism"], filters: { injuryIntent: ["2"] } }),
  },
  {
    name: "sex x race, age-adjusted",
    spec: spec({ groupBy: ["sex", "race6"], filters: { injuryIntent: ["2"] } }),
  },
  {
    name: "grouped by age (age-adjusted must drop out)",
    spec: spec({ groupBy: ["ageTen"], filters: { injuryIntent: ["2"] } }),
  },
  {
    name: "ICD-10 finder codes",
    spec: spec({ groupBy: ["year"], filters: { ucdCause: ["X60", "X61", "U03", "Y87.0"] } }),
  },
  {
    name: "month grouping switches O_dates",
    spec: spec({ groupBy: ["year", "month"] }),
  },
  {
    name: "display options off",
    spec: spec({
      options: { showTotals: false, showZeros: false, showSuppressed: false, ratePer: 1000 },
    }),
  },
];

test("every D158 request carries the verified base parameter set", () => {
  for (const c of CASES) {
    const p = params(buildRequestXml(c.spec));

    // Without this CDC rejects the request outright.
    assert.deepEqual(p.get("accept_datause_restrictions"), ["true"], c.name);

    // The control block that makes D158's "expanded database" grammar work.
    assert.deepEqual(p.get("action-Send"), ["Send"], c.name);
    assert.deepEqual(p.get("stage"), ["request"], c.name);
    assert.deepEqual(p.get("dataset_code"), ["D158"], c.name);
    assert.deepEqual(
      p.get("dataset_label"),
      ["Underlying Cause of Death, by Single-Race Categories"],
      c.name,
    );

    // Selector defaults. O_race and O_age in particular are what make the
    // single-race variables resolve at all.
    assert.deepEqual(p.get("O_race"), ["D158.V42"], c.name);
    assert.deepEqual(p.get("O_location"), ["D158.V9"], c.name);
    assert.deepEqual(p.get("O_urban"), ["D158.V19"], c.name);
    assert.deepEqual(p.get("O_timeout"), ["600"], c.name);
    assert.deepEqual(p.get("O_precision"), ["1"], c.name);
    assert.deepEqual(p.get("O_javascript"), ["on"], c.name);

    // Measures M1-M3 are mandatory for every request.
    assert.deepEqual(p.get("M_1"), ["D158.M1"], c.name);
    assert.deepEqual(p.get("M_2"), ["D158.M2"], c.name);
    assert.deepEqual(p.get("M_3"), ["D158.M3"], c.name);

    // Five group-by slots are always sent, padded with *None*.
    for (let i = 1; i <= 5; i++) {
      assert.equal(p.get(`B_${i}`)?.length, 1, `${c.name}: B_${i}`);
    }
  }
});

test("group-by tokens and their O_ selectors are unchanged", () => {
  const p = params(buildRequestXml(spec({ groupBy: ["year", "injuryMechanism"] })));
  assert.deepEqual(p.get("B_1"), ["D158.V1-level1"]);
  assert.deepEqual(p.get("B_2"), ["D158.V23"]);
  assert.deepEqual(p.get("B_3"), ["*None*"]);
  // Injury mechanism only resolves when O_ucd points at the intent framework.
  assert.deepEqual(p.get("O_ucd"), ["D158.V22"]);

  const byAge = params(buildRequestXml(spec({ groupBy: ["ageFive"] })));
  assert.deepEqual(byAge.get("B_1"), ["D158.V51"]);
  assert.deepEqual(byAge.get("O_age"), ["D158.V51"]);

  const byRace = params(buildRequestXml(spec({ groupBy: ["race31"] })));
  assert.deepEqual(byRace.get("B_1"), ["D158.V44"]);
  assert.deepEqual(byRace.get("O_race"), ["D158.V44"]);
});

test("age-adjusted rate flips O_aar and adds M_4, and drops out when grouping by age", () => {
  const flat = params(buildRequestXml(spec({ groupBy: ["year"] })));
  assert.deepEqual(flat.get("O_aar"), ["aar_std"]);
  assert.deepEqual(flat.get("M_4"), ["D158.M4"]);
  assert.deepEqual(measureColumns(spec({ groupBy: ["year"] })), [
    "deaths",
    "population",
    "crudeRate",
    "ageAdjustedRate",
  ]);

  const byAge = params(buildRequestXml(spec({ groupBy: ["ageTen"] })));
  assert.deepEqual(byAge.get("O_aar"), ["aar_none"]);
  assert.equal(byAge.get("M_4"), undefined);
  assert.deepEqual(measureColumns(spec({ groupBy: ["ageTen"] })), [
    "deaths",
    "population",
    "crudeRate",
  ]);
});

test("value filters go to V_ and finder filters to F_ with their scaffolding", () => {
  const value = params(buildRequestXml(spec({ filters: { sex: ["M"], race6: ["2106-3"] } })));
  assert.deepEqual(value.get("V_D158.V7"), ["M"]);
  assert.deepEqual(value.get("V_D158.V42"), ["2106-3"]);

  const finder = params(
    buildRequestXml(spec({ filters: { ucdCause: ["X60", "X61", "U03"] } })),
  );
  assert.deepEqual(finder.get("F_D158.V2"), ["X60", "X61", "U03"]);
  assert.deepEqual(finder.get("I_D158.V2"), ["X60, X61, U03"]);
  assert.deepEqual(finder.get("O_V2_fmode"), ["freg"]);
  assert.deepEqual(finder.get("finder-stage-D158.V2"), ["codeset"]);
  // Filtering by ICD codes only works when O_ucd selects that framework.
  assert.deepEqual(finder.get("O_ucd"), ["D158.V2"]);
});

test("unfiltered value variables still send their *All* default", () => {
  const p = params(buildRequestXml(spec()));
  // A missing default is silently treated as "no selection" by WONDER and the
  // query returns nothing, so every exposed value variable must be present.
  for (const v of ["V7", "V5", "V51", "V52", "V42", "V43", "V44", "V45", "V17", "V22", "V23", "V28"]) {
    assert.deepEqual(p.get(`V_D158.${v}`), ["*All*"], `V_D158.${v}`);
  }
  assert.deepEqual(p.get("V_D158.V6"), ["00"]);
});

test("display options and rate-per map to their O_ parameters", () => {
  const on = params(buildRequestXml(spec()));
  assert.deepEqual(on.get("O_show_totals"), ["true"]);
  assert.deepEqual(on.get("O_show_zeros"), ["true"]);
  assert.deepEqual(on.get("O_show_suppressed"), ["true"]);
  assert.deepEqual(on.get("O_rate_per"), ["100000"]);

  const off = params(
    buildRequestXml(
      spec({ options: { showTotals: false, showZeros: false, showSuppressed: false, ratePer: 1000 } }),
    ),
  );
  assert.deepEqual(off.get("O_show_totals"), ["false"]);
  assert.deepEqual(off.get("O_show_zeros"), ["false"]);
  assert.deepEqual(off.get("O_show_suppressed"), ["false"]);
  assert.deepEqual(off.get("O_rate_per"), ["1000"]);
});

test("month grouping switches the date resolution", () => {
  assert.deepEqual(params(buildRequestXml(spec({ groupBy: ["year"] }))).get("O_dates"), ["YEAR"]);
  assert.deepEqual(
    params(buildRequestXml(spec({ groupBy: ["year", "month"] }))).get("O_dates"),
    ["MONTH"],
  );
});

// The exact wire contract, pinned. CDC rejects unknown parameters and silently
// changes behaviour when a known one goes missing, so the refactor must not add
// or drop a single name for D158.
const D158_PARAMETER_NAMES = [
  "B_1", "B_2", "B_3", "B_4",
  "B_5", "F_D158.V1", "F_D158.V10", "F_D158.V2",
  "F_D158.V27", "F_D158.V9", "M_1", "M_2",
  "M_3", "M_4", "O_V10_fmode", "O_V1_fmode",
  "O_V27_fmode", "O_V2_fmode", "O_V9_fmode", "O_aar",
  "O_aar_pop", "O_age", "O_dates", "O_javascript",
  "O_location", "O_oc-sect1-request", "O_precision", "O_race",
  "O_rate_per", "O_show_suppressed", "O_show_totals", "O_show_zeros",
  "O_timeout", "O_title", "O_ucd", "O_urban",
  "VM_D158.M6_D158.V10", "VM_D158.M6_D158.V17", "VM_D158.M6_D158.V1_S", "VM_D158.M6_D158.V42",
  "VM_D158.M6_D158.V7", "V_D158.V1", "V_D158.V10", "V_D158.V11",
  "V_D158.V12", "V_D158.V17", "V_D158.V18", "V_D158.V19",
  "V_D158.V2", "V_D158.V20", "V_D158.V21", "V_D158.V22",
  "V_D158.V23", "V_D158.V24", "V_D158.V27", "V_D158.V28",
  "V_D158.V4", "V_D158.V42", "V_D158.V43", "V_D158.V44",
  "V_D158.V45", "V_D158.V5", "V_D158.V51", "V_D158.V52",
  "V_D158.V6", "V_D158.V7", "V_D158.V9", "accept_datause_restrictions",
  "action-Send", "dataset_code", "dataset_label", "finder-stage-D158.V1",
  "finder-stage-D158.V10", "finder-stage-D158.V2", "finder-stage-D158.V27", "finder-stage-D158.V9",
  "saved_id", "stage",
];

test("the full parameter name set is stable", () => {
  const names = [...params(buildRequestXml(spec())).keys()].sort();
  assert.deepEqual(names, D158_PARAMETER_NAMES);
  // Nothing from another database may leak into a D158 request.
  assert.ok(names.every((n) => !/D\d+\./.test(n) || n.includes("D158.")));
});
