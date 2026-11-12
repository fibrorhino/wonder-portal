// Client-side exporters for a ResultTable: CSV (native) and XLSX (SheetJS).
// We only ever WRITE files here (never parse untrusted input), so the xlsx
// package's parsing advisory does not apply.

import * as XLSX from "xlsx";
import type { ResultTable } from "@/lib/wonder/types";

function tableToMatrix(table: ResultTable): (string | number)[][] {
  const header = table.columns.map((c) => c.label);
  const body = table.rows.map((row) =>
    row.map((cell) => {
      if (cell.flag) return cell.raw || cell.flag;
      return cell.value ?? "";
    }),
  );
  return [header, ...body];
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Lines that must travel with the numbers: how a stitched series was put
 * together, and above all which rates were computed here rather than published
 * by CDC. Both exports used to drop them, so a spreadsheet of the combined
 * series carried computed 2025 rates with nothing to mark them.
 */
function assemblyNotes(table: ResultTable): string[] {
  return table.sourceNotes ?? [];
}

export function exportCsv(table: ResultTable, filename = "wonderwall.csv") {
  const matrix: (string | number)[][] = tableToMatrix(table);
  const notes = assemblyNotes(table);
  if (notes.length) {
    // After the data and a blank row, the way CDC WONDER's own exports carry
    // their notes, so the table above still reads as a plain rectangle.
    matrix.push([], ["Notes"], ...notes.map((n) => [n]));
  }
  const csv = matrix
    .map((row) =>
      row
        .map((v) => {
          const s = String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
  // The byte-order mark is for Excel, which otherwise opens a UTF-8 file as
  // Windows-1252 and turns every en dash in a label or note into "â€“".
  triggerDownload(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }), filename);
}

export function exportXlsx(table: ResultTable, filename = "wonderwall.xlsx") {
  const matrix = tableToMatrix(table);
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  const notes = assemblyNotes(table);
  if (notes.length) {
    // Its own sheet, and before CDC's caveats: these are this site's words,
    // not CDC's, and the two are kept apart everywhere else as well.
    const sheet = XLSX.utils.aoa_to_sheet([
      ["How this series was assembled (notes from this site, not from CDC)"],
      ...notes.map((n) => [n]),
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, "Notes");
  }
  if (table.caveats.length) {
    const cav = XLSX.utils.aoa_to_sheet([
      ["CDC WONDER caveats"],
      ...table.caveats.map((c) => [c]),
    ]);
    XLSX.utils.book_append_sheet(wb, cav, "Caveats");
  }
  XLSX.writeFile(wb, filename);
}
