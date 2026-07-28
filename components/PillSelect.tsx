"use client";

// Multi-select rendered as toggleable pills ("select all that apply"), with an
// optional "all" pill that clears the selection (empty selection = all, which
// is how the WONDER query layer already interprets a missing filter).

import type { VariableValue } from "@/lib/wonder/databases";

export default function PillSelect({
  options,
  selected,
  onChange,
  allLabel,
}: {
  options: VariableValue[];
  selected: string[];
  onChange: (codes: string[]) => void;
  allLabel?: string;
}) {
  const toggle = (code: string) => {
    onChange(
      selected.includes(code)
        ? selected.filter((c) => c !== code)
        : [...selected, code],
    );
  };

  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs transition-colors ${
      active
        ? "border-blue-600 bg-blue-600 font-medium text-white"
        : "border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:bg-blue-50"
    }`;

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.code}
          type="button"
          onClick={() => toggle(o.code)}
          aria-pressed={selected.includes(o.code)}
          className={pill(selected.includes(o.code))}
        >
          {o.label}
        </button>
      ))}
      {allLabel && (
        <button
          type="button"
          onClick={() => onChange([])}
          aria-pressed={selected.length === 0}
          className={pill(selected.length === 0)}
        >
          {allLabel}
        </button>
      )}
    </div>
  );
}
