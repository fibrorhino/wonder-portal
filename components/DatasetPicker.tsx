"use client";

// Which CDC WONDER dataset the query runs against.
//
// Switching dataset is not a filter change — it changes which variables exist,
// which measures are available, and how the numbers should be read. So the
// picker states the trade-off rather than presenting two interchangeable
// options, and the page rebuilds the query when it changes.

import { DATABASES } from "@/lib/wonder/db/registry";

export default function DatasetPicker({
  databaseId,
  onChange,
  disabled,
}: {
  databaseId: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const current = DATABASES.find((d) => d.id === databaseId) ?? DATABASES[0];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="text-sm font-semibold text-slate-700" htmlFor="dataset">
          Dataset
        </label>
        <select
          id="dataset"
          value={current.id}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-50 sm:max-w-md"
        >
          {DATABASES.map((d) => (
            <option key={d.id} value={d.id}>
              {d.shortLabel}
            </option>
          ))}
        </select>
        {current.provisional && (
          <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
            Provisional
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-slate-500">{current.blurb}</p>

      {current.provisional && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          The most recent year is <strong>partial</strong> — it covers only the
          months elapsed so far, so its count is not comparable with a full year.
          Trends and talking points leave it out and say so. Age-adjusted rates
          are not published for provisional data.
        </p>
      )}
    </div>
  );
}
