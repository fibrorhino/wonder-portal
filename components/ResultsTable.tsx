"use client";

// Renders a ResultTable as a spreadsheet-like grid with suppression/reliability
// flags, plus CSV/XLSX export.

import { useState } from "react";
import type { ResultTable } from "@/lib/wonder/types";
import { exportCsv, exportXlsx } from "@/lib/export/exporters";

// Dark enough to read on white, on the striped rows and on the tinted total
// rows alike (WCAG AA, 4.5:1). The lighter shades these replaced looked more
// "muted" and measured between 2.4:1 and 3.6:1.
const FLAG_STYLE: Record<string, string> = {
  suppressed: "text-amber-700 italic",
  unreliable: "text-orange-700",
  notApplicable: "text-slate-600 italic",
  missing: "text-slate-600 italic",
};

/**
 * Turn the addresses in a caveat into links. Only CDC's own, and only https:
 * the text comes from CDC's response, and nothing in it should become a link
 * to anywhere else.
 */
function linkify(text: string): React.ReactNode[] {
  const parts = text.split(/(https:\/\/wonder\.cdc\.gov\/[^\s)]+)/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:underline"
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}

export default function ResultsTable({ table }: { table: ResultTable }) {
  const [showCaveats, setShowCaveats] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          {table.rowCount.toLocaleString()} rows
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => exportCsv(table)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void exportXlsx(table)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Export XLSX
          </button>
        </div>
      </div>

      {/* Focusable and named, so the scrolling table can be reached and
          scrolled from the keyboard and is announced as what it is. */}
      <div
        className="max-h-[28rem] overflow-auto rounded-lg border border-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        tabIndex={0}
        role="region"
        aria-label="Query results table"
      >
        <table className="min-w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-slate-100">
            <tr>
              {table.columns.map((c) => (
                <th
                  key={c.key}
                  className={`whitespace-nowrap border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700 ${
                    c.kind === "measure" ? "text-right" : ""
                  }`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => {
              const isTotal = table.rowIsTotal[ri];
              return (
              <tr
                key={ri}
                className={
                  isTotal
                    ? "bg-blue-50 font-semibold text-slate-800"
                    : "odd:bg-white even:bg-slate-50/50"
                }
              >
                {row.map((cell, ci) => {
                  const col = table.columns[ci];
                  const isMeasure = col.kind === "measure";
                  return (
                    <td
                      key={ci}
                      className={`whitespace-nowrap px-3 py-1.5 ${
                        isMeasure ? "text-right tabular-nums" : ""
                      } ${cell.flag ? FLAG_STYLE[cell.flag] : isTotal ? "" : "text-slate-700"}`}
                      title={cell.ci ? `95% CI: ${cell.ci}` : undefined}
                    >
                      {cell.flag
                        ? cell.raw || cell.flag
                        : cell.value === null
                          ? ""
                          : typeof cell.value === "number"
                            ? cell.value.toLocaleString()
                            : cell.value}
                      {cell.ci && (
                        <span className="ml-1 text-xs text-slate-600">
                          {cell.ci}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {table.sourceNotes && table.sourceNotes.length > 0 && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="font-medium text-slate-700">How this series was assembled: </span>
          {table.sourceNotes.join(" ")}
        </div>
      )}

      {table.caveats.length > 0 && (
        <div className="text-xs text-slate-500">
          <button
            type="button"
            onClick={() => setShowCaveats((s) => !s)}
            className="font-medium text-blue-600 hover:underline"
          >
            {showCaveats ? "Hide" : "Show"} CDC WONDER caveats (
            {table.caveats.length})
          </button>
          {showCaveats && (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {table.caveats.map((c, i) => (
                // Each caveat can carry the address of CDC's help page for it;
                // an unbroken URL would otherwise push a phone screen sideways.
                <li key={i} className="break-words">
                  {linkify(c)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
