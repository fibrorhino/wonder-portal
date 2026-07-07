"use client";

// Collapsible checkbox list for selecting a set of value codes. Empty selection
// means "all" (WONDER's default), which we surface in the summary line.

import { useState } from "react";

export interface Option {
  code: string;
  label: string;
}

export default function MultiSelect({
  title,
  options,
  selected,
  onChange,
  note,
  defaultOpen = false,
}: {
  title: string;
  options: Option[];
  selected: string[];
  onChange: (codes: string[]) => void;
  note?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = (code: string) => {
    onChange(
      selected.includes(code)
        ? selected.filter((c) => c !== code)
        : [...selected, code],
    );
  };
  const summary =
    selected.length === 0
      ? "All"
      : selected
          .map((c) => options.find((o) => o.code === c)?.label ?? c)
          .join(", ");

  return (
    <div className="rounded-lg border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-sm font-medium text-slate-700">{title}</span>
        <span className="flex items-center gap-2">
          <span className="max-w-[14rem] truncate text-xs text-slate-500">
            {summary}
          </span>
          <span className="text-slate-400">{open ? "▾" : "▸"}</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-3 py-2">
          {note && <p className="mb-2 text-xs text-slate-500">{note}</p>}
          <div className="flex items-center gap-3 pb-2 text-xs">
            <button
              type="button"
              className="text-blue-600 hover:underline"
              onClick={() => onChange([])}
            >
              Clear (all)
            </button>
            {options.length > 0 && (
              <button
                type="button"
                className="text-blue-600 hover:underline"
                onClick={() => onChange(options.map((o) => o.code))}
              >
                Select all
              </button>
            )}
          </div>
          <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
            {options.map((o) => (
              <label
                key={o.code}
                className="flex items-center gap-2 rounded px-1 py-0.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(o.code)}
                  onChange={() => toggle(o.code)}
                  className="h-4 w-4"
                />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
