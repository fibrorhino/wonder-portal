import test from "node:test";
import assert from "node:assert/strict";
import { axisTypes } from "./chartAxes";

test("category axes are declared, so non-numeric labels are not dropped", () => {
  // The regression this guards: with x left undefined, Plotly saw
  // ["2018".."2024","2025 (provisional)"] as numeric and silently discarded the
  // labels that do not parse.
  for (const t of ["line", "bar", "stackedBar", "area", "heatmap", "treemap"]) {
    assert.equal(axisTypes(t, false).x, "category", t);
  }
});

test("horizontal bars swap which axis holds the categories", () => {
  const a = axisTypes("horizontalBar", false);
  assert.equal(a.y, "category");
  assert.notEqual(a.x, "category", "x carries the measure, not labels");
});

test("scatter and bubble keep a numeric x", () => {
  // These encode year/age as an actual number, so a category axis would ruin
  // the spacing and the regression line.
  for (const t of ["scatter", "bubble"]) {
    assert.equal(axisTypes(t, false).x, undefined, t);
    assert.equal(axisTypes(t, false).y, undefined, t);
  }
});

test("log only applies to the measure axis, never to the category axis", () => {
  const vertical = axisTypes("bar", true);
  assert.equal(vertical.y, "log", "the measure is on y");
  assert.equal(vertical.x, "category", "a log category axis is meaningless");

  const horizontal = axisTypes("horizontalBar", true);
  assert.equal(horizontal.x, "log", "the measure is on x");
  assert.equal(horizontal.y, "category");
});
