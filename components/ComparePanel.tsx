"use client";

// Diff between the pinned result (A) and the current one (B).

import { useMemo, useState } from "react";
import type { MeasureKey, QuerySpec, ResultTable } from "@/lib/wonder/types";
import { compareTables } from "@/lib/analysis/compare";
import { describeFilters, describeGrouping } from "@/lib/describeSpec";

const fmt = (n: number | null, d = 0) =>
  n === null || !Number.isFinite(n)
    ? "—"
    : n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

const MEASURE_OPTIONS: { key: MeasureKey; label: string }[] = [
  { key: "deaths", label: "Deaths" },
  { key: "ageAdjustedRate", label: "Age-adjusted rate" },
  { key: "crudeRate", label: "Crude rate" },
  { key: "population", label: "Population" },
];

function Delta({
  value,
  suffix = "",
  decimals = 0,
}: {
  value: number | null;
  suffix?: string;
  /** Must match the measure being differenced — a rate difference of 17.1
   *  rounded to "17" reads as a whole-number count. */
  decimals?: number;
}) {
  if (value === null || !Number.isFinite(value)) return <span className="text-slate-400">—</span>;
  const up = value > 0;
  const flat = value === 0;
  return (
    <span className={flat ? "text-slate-500" : up ? "text-rose-600" : "text-emerald-700"}>
      {flat ? "" : up ? "▲ " : "▼ "}
      {fmt(Math.abs(value), decimals)}
      {suffix}
    </span>
  );
}

export default function ComparePanel({
  pinned,
  pinnedSpec,
  current,
  currentSpec,
  onUnpin,
}: {
  pinned: ResultTable;
  pinnedSpec?: QuerySpec;
  current: ResultTable;
  currentSpec?: QuerySpec;
  onUnpin: () => void;
}) {
  const [measure, setMeasure] = useState<MeasureKey | undefined>(undefined);
  const cmp = useMemo(
    () => compareTables(pinned, current, measure),
    [pinned, current, measure],
  );

  const describe = (spec?: QuerySpec) =>
    spec ? `${describeGrouping(spec) || "Ungrouped"} — ${describeFilters(spec)}` : "(query unknown)";

  if (!cmp) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
        These two results have no measure in common, so there is nothing to compare.
      </p>
    );
  }

  const isRate = cmp.measureKey === "crudeRate" || cmp.measureKey === "ageAdjustedRate";
  const dp = isRate ? 1 : 0;

  return (
    <div className="space-y-4">
      {/* Which two queries are being compared */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
          <p className="text-xs font-semibold text-violet-800">A · Pinned</p>
          <p className="mt-0.5 text-xs text-violet-900">{describe(pinnedSpec)}</p>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <p className="text-xs font-semibold text-blue-800">B · Current</p>
          <p className="mt-0.5 text-xs text-blue-900">{describe(currentSpec)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          Compare on
          <select
            value={cmp.measureKey}
            onChange={(e) => setMeasure(e.target.value as MeasureKey)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
          >
            {MEASURE_OPTIONS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onUnpin}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Unpin A
        </button>
      </div>

      {cmp.totals.a !== null || cmp.totals.b !== null ? (
        <div className="flex flex-wrap gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          <span>
            <span className="text-xs text-slate-500">Total A </span>
            <strong className="tabular-nums">{fmt(cmp.totals.a)}</strong>
          </span>
          <span>
            <span className="text-xs text-slate-500">Total B </span>
            <strong className="tabular-nums">{fmt(cmp.totals.b)}</strong>
          </span>
          <span>
            <span className="text-xs text-slate-500">Difference </span>
            <strong className="tabular-nums">
              <Delta value={cmp.totals.diff} decimals={dp} />
            </strong>
          </span>
          <span>
            <span className="text-xs text-slate-500">Change </span>
            <strong className="tabular-nums">
              <Delta value={cmp.totals.pctChange} suffix="%" decimals={1} />
            </strong>
          </span>
        </div>
      ) : (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          {cmp.measureLabel} is a rate, so the rows are compared individually — adding rates
          together would not mean anything.
        </p>
      )}

      {cmp.note && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{cmp.note}</p>
      )}

      {cmp.aligned && (
        <div className="max-h-[26rem] overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-slate-100">
              <tr>
                {cmp.dimensionLabels.map((d) => (
                  <th
                    key={d}
                    className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700"
                  >
                    {d}
                  </th>
                ))}
                {["A", "B", "Difference", "Change"].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-right font-semibold text-slate-700"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cmp.rows.map((r) => (
                <tr key={r.key} className="odd:bg-white even:bg-slate-50/50">
                  {r.labels.map((l, i) => (
                    <td key={i} className="whitespace-nowrap px-3 py-1.5 text-slate-700">
                      {l}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-700">
                    {fmt(r.a, dp)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-700">
                    {fmt(r.b, dp)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                    <Delta value={r.diff} decimals={dp} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                    <Delta value={r.pctChange} suffix="%" decimals={1} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Sorted by the size of the difference. ▲ means B is higher than A. Rows present in only
        one result show “—”. Counts are compared as returned; suppressed cells (1–9 deaths) are
        missing from both sides and are not interpolated.
      </p>
    </div>
  );
}
