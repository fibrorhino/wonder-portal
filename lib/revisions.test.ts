import test from "node:test";
import assert from "node:assert/strict";
import type { QuerySpec, ResultCell, ResultColumn, ResultTable } from "./wonder/types";
import { describeRevisions, periodCounts, revisionKey } from "./revisions";

const n = (v: number): ResultCell => ({ value: v, raw: String(v) });
const s = (v: string): ResultCell => ({ value: v, raw: v });
const suppressed = (): ResultCell => ({ value: null, raw: "Suppressed", flag: "suppressed" });

function table(
  dims: { key: string; label: string }[],
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
    { key: "m_deaths", label: "Deaths", kind: "measure", measureKey: "deaths" },
  ];
  return {
    columns,
    rows,
    rowIsTotal: rows.map((_, i) => totals[i] ?? false),
    caveats: [],
    rowCount: rows.length,
  };
}

const spec = (over: Partial<QuerySpec> = {}): QuerySpec => ({
  database: "D176",
  groupBy: ["year"],
  measures: ["deaths"],
  filters: { injuryIntent: ["2"] },
  options: { ratePer: 100000 },
  ...over,
});

test("the same question asked twice gets the same key", () => {
  // Filter order and array order are incidental; the question is the same.
  const a = revisionKey(spec({ filters: { injuryIntent: ["2"], sex: ["M", "F"] } }));
  const b = revisionKey(spec({ filters: { sex: ["F", "M"], injuryIntent: ["2"] } }));
  assert.equal(a, b);
});

test("a different question gets a different key", () => {
  const base = revisionKey(spec());
  assert.notEqual(base, revisionKey(spec({ filters: { injuryIntent: ["1"] } })));
  assert.notEqual(base, revisionKey(spec({ groupBy: ["year", "month"] })));
  assert.notEqual(base, revisionKey(spec({ database: "COMBINED" })));
});

test("the year filter does not split one question's history", () => {
  // Asking for 2025 alone and asking for the whole span both observe 2025.
  // Keying on the year would file those as unrelated questions and the
  // comparison would never fire.
  assert.equal(
    revisionKey(spec({ filters: { injuryIntent: ["2"], year: ["2025"] } })),
    revisionKey(spec({ filters: { injuryIntent: ["2"] } })),
  );
});

test("display options do not split one question's history either", () => {
  assert.equal(
    revisionKey(spec({ options: { ratePer: 100000, showTotals: true } })),
    revisionKey(spec({ options: { ratePer: 100000, showTotals: false } })),
  );
});

test("counts are read per period, and total rows are left out", () => {
  const t = table(
    [{ key: "year", label: "Year" }],
    [[s("2025"), n(49_069)], [s("2026"), n(8_316)], [s("Total"), n(57_385)]],
    [false, false, true],
  );
  assert.deepEqual(periodCounts(spec(), t), [
    { period: "2025", deaths: 49_069 },
    { period: "2026", deaths: 8_316 },
  ]);
});

test("a suppressed period is skipped rather than recorded as zero", () => {
  // Recorded as 0 it would later appear to have been "revised up" by its whole
  // count the moment suppression lifted.
  const t = table([{ key: "year", label: "Year" }], [[s("2025"), n(100)], [s("2026"), suppressed()]]);
  assert.deepEqual(periodCounts(spec(), t), [{ period: "2025", deaths: 100 }]);
});

test("a table grouped by anything but time is refused", () => {
  // Year x method has several rows per period; matching them across vintages
  // breaks when a category appears, and summing them is wrong when suppression
  // differs. Either way the reader could not tell.
  const t = table(
    [{ key: "year", label: "Year" }, { key: "injuryMechanism", label: "Mechanism" }],
    [[s("2025"), s("Firearm"), n(27_000)]],
  );
  assert.equal(periodCounts(spec({ groupBy: ["year", "injuryMechanism"] }), t), null);
});

test("year and month together are fine, since both are time", () => {
  const t = table(
    [{ key: "year", label: "Year" }, { key: "month", label: "Month" }],
    [[s("2026"), s("Jan."), n(4_100)]],
  );
  const got = periodCounts(spec({ groupBy: ["year", "month"] }), t);
  assert.deepEqual(got, [{ period: "2026 Jan.", deaths: 4_100 }]);
});

test("an ungrouped table has no periods to track", () => {
  const t = table([], [[n(49_069)]]);
  assert.equal(periodCounts(spec({ groupBy: [] }), t), null);
});

test("the revision line names the period, the size and the direction", () => {
  const line = describeRevisions({
    previousObservedAt: "2026-08-12T09:00:00.000Z",
    changes: [
      { period: "2025 (provisional)", before: 48_657, after: 49_069, delta: 412, pct: 0.8467 },
    ],
  });
  assert.match(line, /Since Aug 12, 2026/);
  // The "(provisional)" annotation is dropped: the notice is about provisional
  // figures by definition, and it reads badly inside the sentence.
  assert.match(line, /2025 revised up 412 deaths \(\+0\.8%\)/);
  assert.ok(!/2025 \(provisional\) revised/.test(line), line);
});

test("a downward revision is described as down, not as a negative rise", () => {
  const line = describeRevisions({
    previousObservedAt: "2026-08-12T09:00:00.000Z",
    changes: [{ period: "2026", before: 8_400, after: 8_316, delta: -84, pct: -1.0 }],
  });
  assert.match(line, /revised down 84 deaths \(-1\.0%\)/);
  assert.ok(!/-84/.test(line), line);
});

test("one death is not 'deaths'", () => {
  const line = describeRevisions({
    previousObservedAt: "2026-08-12T09:00:00.000Z",
    changes: [{ period: "2026", before: 10, after: 11, delta: 1, pct: 10 }],
  });
  assert.match(line, /1 death \(/);
});

test("a malformed stored date does not render as Invalid Date", () => {
  const line = describeRevisions({
    previousObservedAt: "not a date",
    changes: [{ period: "2025", before: 1, after: 2, delta: 1, pct: 100 }],
  });
  assert.match(line, /Since the previous check/);
  assert.ok(!/Invalid Date/.test(line), line);
});
