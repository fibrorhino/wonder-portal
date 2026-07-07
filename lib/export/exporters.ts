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

export function exportCsv(table: ResultTable, filename = "wonderwall.csv") {
  const matrix = tableToMatrix(table);
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
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8;" }), filename);
}

export function exportXlsx(table: ResultTable, filename = "wonderwall.xlsx") {
  const matrix = tableToMatrix(table);
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  if (table.caveats.length) {
    const cav = XLSX.utils.aoa_to_sheet([
      ["CDC WONDER caveats"],
      ...table.caveats.map((c) => [c]),
    ]);
    XLSX.utils.book_append_sheet(wb, cav, "Caveats");
  }
  XLSX.writeFile(wb, filename);
}
