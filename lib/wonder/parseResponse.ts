// Parses a CDC WONDER XML response into a normalized ResultTable. WONDER returns
// a <data-table> of <r> rows and <c> cells; higher-level group labels use a
// rowspan `r` attribute and are omitted in continuation rows, so we reconstruct
// them. Dependency-free (regex over the well-structured data-table region).

import type {
  CellFlag,
  MeasureKey,
  QuerySpec,
  ResultCell,
  ResultColumn,
  ResultTable,
} from "./types";
import { measureColumns } from "./buildRequest";
import { VARIABLE_BY_KEY } from "./databases";

const MEASURE_LABELS: Record<MeasureKey, string> = {
  deaths: "Deaths",
  population: "Population",
  crudeRate: "Crude Rate",
  ageAdjustedRate: "Age-Adjusted Rate",
};

interface ParsedCell {
  label?: string; // l="..." (dimension label)
  value?: string; // v="..." (measure value on a data row)
  total?: string; // dt="..." (measure value on a subtotal/total row)
  rowspan: number; // r="..."
  ci?: string; // nested <l v="(...)"/>
  isMeasure: boolean; // has v or dt
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? decode(m[1]) : undefined;
}

/** Detect a WONDER error page and return its message, if any. */
export function extractError(xml: string): string | null {
  const em = xml.match(/<message[^>]*error="true"[^>]*>([\s\S]*?)<\/message>/i);
  if (em) return decode(em[1].replace(/<[^>]+>/g, " ").trim());
  if (/<title>\s*Processing Error/i.test(xml)) {
    const msg = xml.match(/<message>([\s\S]*?)<\/message>/i);
    return msg
      ? decode(msg[1].replace(/<[^>]+>/g, " ").trim())
      : "WONDER processing error (no detail provided).";
  }
  return null;
}

function parseRow(rowXml: string): ParsedCell[] {
  const cells: ParsedCell[] = [];
  // Match self-closing <c .../> or paired <c ...>...</c>
  const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowXml))) {
    const attrs = m[1];
    const inner = m[2] ?? "";
    const ciMatch = inner.match(/<l\s+v="([^"]*)"/);
    const value = attr(attrs, "v");
    const total = attr(attrs, "dt"); // subtotal/total value cell
    cells.push({
      label: attr(attrs, "l"),
      value,
      total,
      rowspan: parseInt(attr(attrs, "r") ?? "1", 10) || 1,
      ci: ciMatch ? decode(ciMatch[1]) : undefined,
      isMeasure: value !== undefined || total !== undefined,
    });
  }
  return cells;
}

function toResultCell(raw: string | undefined, ci?: string): ResultCell {
  if (raw == null) return { value: null, raw: "" };
  const text = raw.trim();
  let flag: CellFlag | undefined;
  if (/suppress/i.test(text)) flag = "suppressed";
  else if (/unreliable/i.test(text)) flag = "unreliable";
  else if (/not applicable/i.test(text)) flag = "notApplicable";
  else if (/missing/i.test(text)) flag = "missing";
  if (flag) return { value: null, raw: text, flag, ci };
  const num = Number(text.replace(/,/g, ""));
  if (text !== "" && !Number.isNaN(num)) return { value: num, raw: text, ci };
  return { value: text, raw: text, ci };
}

export function parseResponse(xml: string, spec: QuerySpec): ResultTable {
  const dimKeys = spec.groupBy.slice(0, 5);
  const dimCount = dimKeys.length;
  const measures = measureColumns(spec);

  const columns: ResultColumn[] = [
    ...dimKeys.map((key) => ({
      key: `dim_${key}`,
      label: VARIABLE_BY_KEY[key]?.label ?? key,
      kind: "dimension" as const,
      variableKey: key,
    })),
    ...measures.map((mk) => ({
      key: `m_${mk}`,
      label: MEASURE_LABELS[mk],
      kind: "measure" as const,
      measureKey: mk,
    })),
  ];

  const dtMatch = xml.match(/<data-table[^>]*>([\s\S]*?)<\/data-table>/);
  const rows: ResultCell[][] = [];
  const rowIsTotal: boolean[] = [];
  const caveats = extractCaveats(xml);

  if (!dtMatch) {
    return { columns, rows, rowIsTotal, caveats, rowCount: 0 };
  }

  const rowXmls = dtMatch[1].match(/<r>[\s\S]*?<\/r>/g) ?? [];
  // Rowspan carry state for dimension columns.
  const carryValue: (ParsedCell | null)[] = Array(Math.max(dimCount, 1)).fill(null);
  const carrySpan: number[] = Array(Math.max(dimCount, 1)).fill(0);

  for (const rowXml of rowXmls) {
    const parsed = parseRow(rowXml);
    // Total/subtotal rows carry measure values in `dt=` and mark the totalled
    // dimension with an empty <c c="N"/> cell (no label).
    const isTotalRow = parsed.some((c) => c.total !== undefined);
    const dimQueue = parsed.filter((c) => !c.isMeasure);
    const measureQueue = parsed.filter((c) => c.isMeasure);
    const outCells: ResultCell[] = [];

    // Dimension columns (with rowspan reconstruction). Outer dims are carried;
    // on a total row the non-carried inner dims become "Total".
    for (let col = 0; col < dimCount; col++) {
      let label: string;
      if (carrySpan[col] > 0 && carryValue[col]) {
        label = (carryValue[col]!.label ?? "").trim();
        carrySpan[col]--;
      } else {
        const cell = dimQueue.shift();
        if (cell && cell.rowspan > 1) {
          carrySpan[col] = cell.rowspan - 1;
          carryValue[col] = cell;
        }
        const raw = (cell?.label ?? "").trim();
        label = raw !== "" ? raw : isTotalRow ? "Total" : "";
      }
      outCells.push({ value: label, raw: label });
    }

    // Measure columns (value from `v=` on data rows, `dt=` on total rows).
    for (let i = 0; i < measures.length; i++) {
      const cell = measureQueue.shift();
      outCells.push(toResultCell(cell?.value ?? cell?.total, cell?.ci));
    }

    const isTotal = isTotalRow || outCells.slice(0, dimCount).some((c) => c.raw === "Total");

    // Keep subtotal / grand-total rows (flagged) so the table can show them;
    // chart/stats consumers filter them via dataRows(). Skip pure padding rows.
    const allEmpty = outCells.every((c) => c.raw === "");
    if (allEmpty) continue;

    // WONDER emits the grand total at multiple levels (c="1", c="2", ...),
    // producing identical adjacent total rows — collapse them.
    if (isTotal && rows.length > 0 && rowIsTotal[rows.length - 1]) {
      const prev = rows[rows.length - 1];
      const same =
        prev.length === outCells.length &&
        prev.every((c, i) => c.raw === outCells[i].raw);
      if (same) continue;
    }

    rows.push(outCells);
    rowIsTotal.push(isTotal);
  }

  const dataCount = rowIsTotal.filter((t) => !t).length;
  return { columns, rows, rowIsTotal, caveats, rowCount: dataCount };
}

function extractCaveats(xml: string): string[] {
  const out: string[] = [];
  const re = /<caveat\b[^>]*>([\s\S]*?)<\/caveat>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const text = decode(
      m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    );
    if (text) out.push(text);
  }
  return out;
}
