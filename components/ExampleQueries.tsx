"use client";

// Starting points. Clicking one loads the spec into the builder and runs it, so
// a first visit lands on real data instead of an empty form.

import { examplesFor } from "@/lib/wonder/examples";
import type { QuerySpec } from "@/lib/wonder/types";

export default function ExampleQueries({
  databaseId,
  onPick,
  disabled,
}: {
  databaseId: string;
  onPick: (spec: QuerySpec) => void;
  disabled?: boolean;
}) {
  const examples = examplesFor(databaseId);
  if (examples.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-slate-500">Start from an example</p>
      {/* One line that scrolls, at every width, matching the recent-query row
          directly below it. It used to wrap at sm: and up, which put a lone
          chip on a second row as soon as there were eight of them. */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {examples.map((e) => (
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
