// Core typed contract for the whole app. The query builder (and, later, the LLM
// natural-language interpreter) both produce a QuerySpec; the /api/wonder route
// is the only consumer. Keep this stable.

export type MeasureKey = "deaths" | "population" | "crudeRate" | "ageAdjustedRate";

export const ALL_MEASURES: { key: MeasureKey; label: string }[] = [
  { key: "deaths", label: "Deaths" },
  { key: "population", label: "Population" },
  { key: "crudeRate", label: "Crude Rate (per 100k)" },
  { key: "ageAdjustedRate", label: "Age-Adjusted Rate (per 100k)" },
];

// A QuerySpec references variables and codes by our friendly keys (see databases.ts).
// filters maps a variableKey -> selected value codes. Empty / missing = "all".
export interface QuerySpec {
  database: string; // e.g. "D158"
  groupBy: string[]; // ordered variable keys, max 5 -> B_1..B_5
  measures: MeasureKey[];
  filters: Record<string, string[]>;
  options: {
    ratePer?: number; // default 100000
    showTotals?: boolean; // default true — subtotal/total rows
    showZeros?: boolean; // default true — rows with zero deaths
    showSuppressed?: boolean; // default true — suppressed (1-9) cells
  };
}

export type CellFlag =
  | "suppressed" // counts 1-9 hidden for privacy
  | "unreliable" // rate based on <20 deaths
  | "notApplicable"
  | "missing";

export interface ResultCell {
  value: number | string | null; // numeric when parseable, else raw label/text
  raw: string;
  flag?: CellFlag;
  ci?: string; // confidence interval text for rates, if present
}

export interface ResultColumn {
  key: string; // stable key
  label: string; // header label
  kind: "dimension" | "measure";
  measureKey?: MeasureKey;
  variableKey?: string;
}

export interface ResultTable {
  columns: ResultColumn[];
  rows: ResultCell[][]; // aligned with columns
  rowIsTotal: boolean[]; // per-row: WONDER subtotal / grand-total row
  caveats: string[];
  title?: string;
  rowCount: number; // count of data (non-total) rows
}

export interface WonderResponse {
  ok: boolean;
  table?: ResultTable;
  error?: string;
  // echoes so the client knows how to render / chart
  spec: QuerySpec;
}
