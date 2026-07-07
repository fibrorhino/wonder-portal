"use client";

// The manual query builder. Produces a QuerySpec (the same contract the future
// LLM box will emit). Sections: cause of death, group-by (ordered), filters,
// and measures.

import { useMemo, useState } from "react";
import type { MeasureKey, QuerySpec } from "@/lib/wonder/types";
import { ALL_MEASURES } from "@/lib/wonder/types";
import {
  CAUSE_PRESETS,
  VARIABLES,
  VARIABLE_BY_KEY,
} from "@/lib/wonder/databases";
import MultiSelect from "./MultiSelect";

const CAUSE_KEYS = ["ucdCause", "injuryIntent", "injuryMechanism", "leadingCauses"];
const FILTER_KEYS = [
  "year",
  "sex",
  "ageTen",
  "ageFive",
  "race6",
  "race15",
  "race31",
  "hispanicOrigin",
  "education",
  "weekday",
  "placeOfDeath",
  "autopsy",
];

const groupableVars = VARIABLES.filter((v) => v.canGroup);

export default function QueryBuilder({
  spec,
  onChange,
  onRun,
  loading,
}: {
  spec: QuerySpec;
  onChange: (spec: QuerySpec) => void;
  onRun: () => void;
  loading: boolean;
}) {
  const [icdText, setIcdText] = useState("");

  const setFilters = (filters: Record<string, string[]>) =>
    onChange({ ...spec, filters });
  const setFilter = (key: string, codes: string[]) => {
    const next = { ...spec.filters };
    if (codes.length === 0) delete next[key];
    else next[key] = codes;
    setFilters(next);
  };

  const applyPreset = (idx: number) => {
    const preset = CAUSE_PRESETS[idx];
    const next = { ...spec.filters };
    for (const k of CAUSE_KEYS) delete next[k];
    for (const [k, v] of Object.entries(preset.apply)) next[k] = v as string[];
    setFilters(next);
    setIcdText((preset.apply.ucdCause as string[] | undefined)?.join(", ") ?? "");
  };

  const applyIcd = (text: string) => {
    setIcdText(text);
    const codes = text
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const next = { ...spec.filters };
    for (const k of CAUSE_KEYS) delete next[k];
    if (codes.length) next.ucdCause = codes;
    setFilters(next);
  };

  // Group-by management
  const addGroup = (key: string) => {
    if (!key || spec.groupBy.includes(key) || spec.groupBy.length >= 5) return;
    onChange({ ...spec, groupBy: [...spec.groupBy, key] });
  };
  const removeGroup = (key: string) =>
    onChange({ ...spec, groupBy: spec.groupBy.filter((k) => k !== key) });
  const moveGroup = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= spec.groupBy.length) return;
    const g = [...spec.groupBy];
    [g[i], g[j]] = [g[j], g[i]];
    onChange({ ...spec, groupBy: g });
  };

  const toggleMeasure = (m: MeasureKey) => {
    const has = spec.measures.includes(m);
    onChange({
      ...spec,
      measures: has
        ? spec.measures.filter((x) => x !== m)
        : [...spec.measures, m],
    });
  };

  const availableToAdd = groupableVars.filter(
    (v) => !spec.groupBy.includes(v.key),
  );

  const activeCause = useMemo(
    () => CAUSE_KEYS.filter((k) => spec.filters[k]?.length),
    [spec.filters],
  );

  return (
    <div className="space-y-5">
      {/* Cause of death */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">
          Cause of death
        </h3>
        <div className="flex flex-wrap gap-2">
          {CAUSE_PRESETS.map((p, i) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(i)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:border-blue-400 hover:bg-blue-50"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <label className="text-xs font-medium text-slate-600">
            Advanced: ICD-10 codes (comma/space separated, e.g. X60-X84, U03, Y87.0)
          </label>
          <input
            value={icdText}
            onChange={(e) => applyIcd(e.target.value)}
            placeholder="Leave blank for all causes"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        {/* injury mechanism / intent as filters */}
        <div className="mt-3 space-y-2">
          {["injuryMechanism", "injuryIntent"].map((k) => {
            const v = VARIABLE_BY_KEY[k];
            return (
              <MultiSelect
                key={k}
                title={v.label}
                note={v.note}
                options={v.values}
                selected={spec.filters[k] ?? []}
                onChange={(codes) => {
                  // choosing an injury-framework filter clears the ICD framework
                  const next = { ...spec.filters };
                  delete next.ucdCause;
                  setIcdText("");
                  if (codes.length === 0) delete next[k];
                  else next[k] = codes;
                  setFilters(next);
                }}
              />
            );
          })}
        </div>
        {activeCause.length > 1 && (
          <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
            Only one cause framework can be used per query. Keep just one of:
            ICD codes, injury intent/mechanism, or leading causes.
          </p>
        )}
      </section>

      {/* Group by */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">
          Group results by{" "}
          <span className="font-normal text-slate-500">
            (ordered, up to 5)
          </span>
        </h3>
        <div className="space-y-2">
          {spec.groupBy.map((key, i) => (
            <div
              key={key}
              className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5"
            >
              <span className="text-sm text-slate-700">
                {i + 1}. {VARIABLE_BY_KEY[key]?.label ?? key}
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveGroup(i, -1)}
                  disabled={i === 0}
                  className="rounded px-1 text-slate-500 hover:bg-slate-200 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveGroup(i, 1)}
                  disabled={i === spec.groupBy.length - 1}
                  className="rounded px-1 text-slate-500 hover:bg-slate-200 disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeGroup(key)}
                  className="rounded px-1 text-red-500 hover:bg-red-100"
                >
                  ✕
                </button>
              </span>
            </div>
          ))}
          {spec.groupBy.length === 0 && (
            <p className="text-xs text-slate-400">
              Add at least one grouping (e.g. Year).
            </p>
          )}
        </div>
        {spec.groupBy.length < 5 && (
          <select
            value=""
            onChange={(e) => addGroup(e.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">+ Add grouping…</option>
            {availableToAdd.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
              </option>
            ))}
          </select>
        )}
      </section>

      {/* Filters */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">
          Filters{" "}
          <span className="font-normal text-slate-500">
            (leave blank for all)
          </span>
        </h3>
        <div className="space-y-2">
          {FILTER_KEYS.map((k) => {
            const v = VARIABLE_BY_KEY[k];
            if (!v || v.values.length === 0) return null;
            return (
              <MultiSelect
                key={k}
                title={v.label}
                note={v.note}
                options={v.values}
                selected={spec.filters[k] ?? []}
                onChange={(codes) => setFilter(k, codes)}
              />
            );
          })}
        </div>
      </section>

      {/* Measures */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Measures</h3>
        <div className="flex flex-wrap gap-3">
          {ALL_MEASURES.map((m) => (
            <label
              key={m.key}
              className="flex items-center gap-2 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                checked={spec.measures.includes(m.key)}
                onChange={() => toggleMeasure(m.key)}
                disabled={m.key === "deaths"}
                className="h-4 w-4"
              />
              {m.label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Age-adjusted rate is unavailable when grouping by age.
        </p>
      </section>

      {/* Display options */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Display</h3>
        <div className="flex flex-col gap-2">
          {(
            [
              ["showTotals", "Show totals / subtotals"],
              ["showZeros", "Show zero values"],
              ["showSuppressed", "Show suppressed values"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={spec.options[key] !== false}
                onChange={(e) =>
                  onChange({
                    ...spec,
                    options: { ...spec.options, [key]: e.target.checked },
                  })
                }
                className="h-4 w-4"
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={onRun}
        disabled={loading || spec.groupBy.length === 0}
        className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {loading ? "Querying CDC WONDER…" : "Run query"}
      </button>
    </div>
  );
}
