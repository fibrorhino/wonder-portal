// Helpers for turning a ResultTable into chartable / analyzable series.

import type { ResultCell, ResultColumn, ResultTable } from "@/lib/wonder/types";
import { ageGroupMidpoint, monthOrdinal } from "@/lib/stats/regression";

export interface ColRef {
  index: number;
  column: ResultColumn;
}

/** Data rows only (excludes WONDER subtotal/total rows) — for charts & stats. */
export function dataRows(table: ResultTable): ResultCell[][] {
  return table.rows.filter((_, i) => !table.rowIsTotal[i]);
}

export function dimensionCols(table: ResultTable): ColRef[] {
  return table.columns
    .map((column, index) => ({ column, index }))
    .filter((c) => c.column.kind === "dimension");
}

export function measureCols(table: ResultTable): ColRef[] {
  return table.columns
    .map((column, index) => ({ column, index }))
    .filter((c) => c.column.kind === "measure");
}

export function cellNumber(cell: ResultCell | undefined): number | null {
  if (!cell) return null;
  return typeof cell.value === "number" ? cell.value : null;
}

export function cellLabel(cell: ResultCell | undefined): string {
  if (!cell) return "";
  return cell.value === null ? cell.raw : String(cell.value);
}

/**
 * Encode a dimension value as a number where meaningful (year, month, age).
 * Returns null for purely categorical dimensions (sex, race, mechanism...).
 */
export function numericEncode(variableKey: string | undefined, label: string): number | null {
  if (!variableKey) return null;
  if (variableKey === "year") {
    const n = parseInt(label, 10);
    return Number.isFinite(n) ? n : null;
  }
  if (variableKey === "month") return monthOrdinal(label);
  if (variableKey.startsWith("age")) return ageGroupMidpoint(label);
  return null;
}
