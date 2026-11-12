// The shape and sense checks every query passes through before a request is
// built. These lived untested inside the API route; each "shape" case below
// used to be an unhandled exception and a bare HTTP 500.

import test from "node:test";
import assert from "node:assert/strict";
import type { QuerySpec } from "./types";
import { normalizeSpec, validateSpec } from "./validateSpec";
import { buildRequestXml } from "./buildRequest";
import { EXAMPLE_QUERIES, examplesFor } from "./examples";
import { DATABASES } from "./db/registry";

const good = {
  database: "D158",
  groupBy: ["year"],
  measures: ["deaths", "population"],
  filters: { injuryIntent: ["2"] },
  options: { ratePer: 100000 },
};

const asSpec = (raw: unknown): QuerySpec => {
  const spec = normalizeSpec(raw);
  assert.equal(typeof spec, "object", `expected a spec, got: ${String(spec)}`);
  return spec as QuerySpec;
};

test("a well-formed body comes through unchanged", () => {
  const spec = asSpec(good);
  assert.deepEqual(spec, good);
  assert.equal(validateSpec(spec), null);
});

test("bodies that are not a spec are refused, not thrown on", () => {
  for (const raw of [null, undefined, 42, "D158", [], [good]]) {
    assert.equal(typeof normalizeSpec(raw), "string", `accepted ${JSON.stringify(raw)}`);
  }
  assert.equal(typeof normalizeSpec({ ...good, database: 158 }), "string");
  assert.equal(typeof normalizeSpec({ ...good, groupBy: "year" }), "string");
  assert.equal(typeof normalizeSpec({ ...good, groupBy: [1, 2] }), "string");
});

test("missing measures, filters and options are filled in", () => {
  const spec = asSpec({ database: "D158", groupBy: ["year"] });
  assert.deepEqual(spec.measures, []);
  assert.deepEqual(spec.filters, {});
  assert.deepEqual(spec.options, {});
  // The request builder reads all three without checking; it must not throw.
  assert.ok(buildRequestXml(spec).includes("<name>B_1</name>"));
});

test("a filter sent as a string is refused rather than split into characters", () => {
  // set("V_...", ...codes) spreads its argument: "2020" became "2","0","2","0".
  const out = normalizeSpec({ ...good, filters: { year: "2020" } });
  assert.equal(typeof out, "string");
  assert.match(out as string, /year/);
});

test("an empty or null filter is dropped, and oversized ones are refused", () => {
  assert.deepEqual(asSpec({ ...good, filters: { sex: null, year: [] } }).filters, { year: [] });
  assert.equal(typeof normalizeSpec({ ...good, filters: { ucdCause: ["X".repeat(41)] } }), "string");
  assert.equal(
    typeof normalizeSpec({ ...good, filters: { ucdCause: Array(2001).fill("X60") } }),
    "string",
  );
});

test("unknown measures are dropped; the rate denominator must be a known one", () => {
  assert.deepEqual(asSpec({ ...good, measures: ["deaths", "bogus", 7] }).measures, ["deaths"]);
  assert.equal(typeof normalizeSpec({ ...good, options: { ratePer: 12345 } }), "string");
  assert.equal(typeof normalizeSpec({ ...good, options: { ratePer: "100000" } }), "string");
  assert.equal(asSpec({ ...good, options: { ratePer: 1000 } }).options.ratePer, 1000);
  // Unknown option keys never reach the request.
  assert.deepEqual(asSpec({ ...good, options: { evil: "<x>", showTotals: false } }).options, {
    showTotals: false,
  });
});

test("queries WONDER cannot run are explained", () => {
  const v = (over: Partial<QuerySpec>) => validateSpec({ ...asSpec(good), ...over });
  assert.match(v({ database: "D999" })!, /Unknown dataset/);
  assert.match(v({ groupBy: [] })!, /at least one/);
  assert.match(v({ groupBy: ["year", "year"] })!, /twice/);
  assert.match(v({ groupBy: ["state"] })!, /Unknown variable/);
  assert.match(v({ groupBy: ["ageTen", "ageFive"] })!, /one age grouping/);
  assert.match(v({ groupBy: ["race6", "race15"] })!, /one race grouping/);
  assert.match(v({ filters: { nope: ["1"] } })!, /Unknown filter variable/);
  assert.match(v({ filters: { month: ["1"] } })!, /Cannot filter by/);
  assert.match(
    v({ groupBy: ["year"], filters: { ageTen: ["15-24"], ageFive: ["15-19"] } })!,
    /Only one age variable/,
  );
  assert.match(
    v({ groupBy: ["injuryMechanism"], filters: { ucdCause: ["X60"] } })!,
    /cause-of-death framework/,
  );
  // The provisional file publishes no age-adjusted rate.
  assert.match(
    v({ database: "D176", measures: ["deaths", "ageAdjustedRate"], filters: {} })!,
    /does not provide/,
  );
});

test("every example the site offers passes its own validation", () => {
  // A chip that is refused by the endpoint it posts to is a broken front page.
  assert.ok(EXAMPLE_QUERIES.length > 0);
  for (const db of DATABASES) {
    for (const example of examplesFor(db.id)) {
      const spec = asSpec(JSON.parse(JSON.stringify(example.spec)));
      assert.equal(validateSpec(spec), null, `${db.id}: ${example.label}`);
    }
  }
});
