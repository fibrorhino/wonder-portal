import test from "node:test";
import assert from "node:assert/strict";
import type { QuerySpec } from "../types";
import { buildRequestXml, measureColumns } from "../buildRequest";
import { DATABASES, D158, getDatabase, isKnownDatabase } from "./registry";
import { D176 } from "./d176";

const spec = (over: Partial<QuerySpec> = {}): QuerySpec => ({
  database: "D176",
  groupBy: ["year"],
  measures: ["deaths", "population", "crudeRate"],
  filters: {},
  options: { showTotals: true, showZeros: true, showSuppressed: true, ratePer: 100000 },
  ...over,
});

function params(xml: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const b of xml.match(/<parameter>[\s\S]*?<\/parameter>/g) ?? []) {
    const name = /<name>([\s\S]*?)<\/name>/.exec(b)?.[1] ?? "";
    out.set(name, [...b.matchAll(/<value>([\s\S]*?)<\/value>/g)].map((m) => m[1]));
  }
  return out;
}

test("an unknown dataset falls back rather than throwing", () => {
  // The id can arrive from a shared link or stored history.
  assert.equal(getDatabase("D999").id, "D158");
  assert.equal(getDatabase(undefined).id, "D158");
  assert.equal(isKnownDatabase("D999"), false);
  assert.equal(isKnownDatabase("D176"), true);
});

test("every dataset targets its own variables and endpoint id", () => {
  for (const db of DATABASES) {
    for (const v of db.variables) {
      assert.ok(
        v.varCode.startsWith(`${db.id}.`),
        `${db.id}: ${v.key} points at ${v.varCode}`,
      );
      assert.ok(v.groupToken.startsWith(`${db.id}.`), `${db.id}: ${v.key} group token`);
      if (v.control) {
        assert.ok(
          v.control.value.startsWith(`${db.id}.`),
          `${db.id}: ${v.key} control ${v.control.value}`,
        );
      }
    }
  }
});

test("a D176 request carries the parameters D158 does not, and none of D158's ids", () => {
  const p = params(buildRequestXml(spec()));
  assert.deepEqual(p.get("dataset_code"), ["D176"]);
  assert.deepEqual(
    p.get("dataset_label"),
    ["Provisional Mortality Statistics, 2018 through Last Month"],
  );
  // Without O_PR the endpoint answers "Missing parameter O_PR".
  assert.deepEqual(p.get("O_PR"), ["false"]);
  // The scaffolding that a reconstructed request omitted, producing HTTP 500.
  for (const name of ["V_D176.V13", "L_D176.V15", "O_death_urban", "F_D176.V77"]) {
    assert.ok(p.has(name), `missing ${name}`);
  }
  // Nothing may reference the other database.
  for (const name of p.keys()) {
    assert.ok(!name.includes("D158"), `leaked ${name}`);
  }
  for (const values of p.values()) {
    for (const v of values) assert.ok(!v.includes("D158"), `leaked value ${v}`);
  }
});

test("provisional data offers no age-adjusted rate, even when asked for", () => {
  assert.ok(!D176.measures.includes("ageAdjustedRate"));
  const asked = spec({ measures: ["deaths", "population", "crudeRate", "ageAdjustedRate"] });
  // Requesting it must not put M_4 on the wire or claim the column exists.
  assert.equal(params(buildRequestXml(asked)).get("M_4"), undefined);
  assert.deepEqual(measureColumns(asked), ["deaths", "population", "crudeRate"]);
  // D158 still does offer it.
  assert.ok(D158.measures.includes("ageAdjustedRate"));
});

test("D176 exposes only variables it actually has", () => {
  const keys = new Set(D176.variables.map((v) => v.key));
  // Present in D158, absent from the provisional file.
  for (const missing of ["weekday", "education", "leadingCauses", "autopsy", "race31"]) {
    assert.ok(!keys.has(missing), `${missing} should not be offered for D176`);
  }
  for (const present of ["year", "sex", "ageTen", "race6", "injuryIntent", "ucdCause"]) {
    assert.ok(keys.has(present), `${present} should be offered for D176`);
  }
});

test("the provisional dataset covers more years than the final one", () => {
  const last = (d: typeof D158) => d.years[d.years.length - 1];
  assert.ok(
    Number(last(D176)) > Number(last(D158)),
    "the reason to have D176 at all is that it runs later",
  );
  assert.equal(D176.provisional, true);
  assert.equal(D158.provisional, false);
});
