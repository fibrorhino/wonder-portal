"use client";

// The last few queries run in this browser. Re-running one is a click, which
// matters because every CDC query costs at least a 15-second wait.

import type { HistoryEntry } from "@/lib/queryHistory";
import { relativeTime } from "@/lib/queryHistory";
import type { QuerySpec } from "@/lib/wonder/types";

export default function RecentQueries({
  entries,
  onPick,
  onClear,
  disabled,
}: {
  entries: HistoryEntry[];
  onPick: (spec: QuerySpec) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  if (entries.length === 0) return null;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <p className="text-xs font-medium text-slate-500">Recent queries</p>
        <button
          type="button"
          onClick={onClear}
          className="text-[11px] text-slate-400 underline decoration-dotted hover:text-slate-600"
        >
          clear
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {entries.map((e) => (
          <button
            key={e.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(structuredClone(e.spec))}
            title={`${e.label} — ${e.detail}`}
            className="group shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left transition hover:border-violet-400 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="block max-w-[16rem] truncate text-xs font-medium text-slate-700 group-hover:text-violet-800">
              {e.label}
            </span>
            <span className="block max-w-[16rem] truncate text-[11px] text-slate-400">
              {e.detail} · {relativeTime(e.at)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
