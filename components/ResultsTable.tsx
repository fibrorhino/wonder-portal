"use client";

// Renders a ResultTable as a spreadsheet-like grid with suppression/reliability
// flags, plus CSV/XLSX export.

import { useState } from "react";
import type { ResultTable } from "@/lib/wonder/types";
import { exportCsv, exportXlsx } from "@/lib/export/exporters";

const FLAG_STYLE: Record<string, string> = {
  suppressed: "text-amber-600 italic",
  unreliable: "text-orange-600",
  notApplicable: "text-slate-400",
  missing: "text-slate-400",
};

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
            onClick={() => exportXlsx(table)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Export XLSX
          </button>
        </div>
      </div>

      <div className="max-h-[28rem] overflow-auto rounded-lg border border-slate-200">
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
                        <span className="ml-1 text-xs text-slate-400">
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
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
