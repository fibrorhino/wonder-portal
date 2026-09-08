"use client";

// Starting points. Clicking one loads the spec into the builder and runs it, so
// a first visit lands on real data instead of an empty form.

import { EXAMPLE_QUERIES } from "@/lib/wonder/examples";
import type { QuerySpec } from "@/lib/wonder/types";

export default function ExampleQueries({
  onPick,
  disabled,
}: {
  onPick: (spec: QuerySpec) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-slate-500">Start from an example</p>
      <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-x-visible sm:pb-0">
        {EXAMPLE_QUERIES.map((e) => (
          <button
            key={e.label}
            type="button"
            disabled={disabled}
            onClick={() => onPick(structuredClone(e.spec))}
            title={e.hint}
            className="group shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left transition hover:border-blue-400 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="block text-xs font-medium text-slate-700 group-hover:text-blue-800">
              {e.label}
            </span>
            <span className="block text-[11px] text-slate-400">{e.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
