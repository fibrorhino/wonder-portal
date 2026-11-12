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
import { getDatabase, variableByKey } from "./db/registry";

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

/**
 * A response body as text, in the character set the response declares.
 *
 * CDC sends "text/html;charset=ISO-8859-1" and means it (the data-use notice in
 * every provisional response carries a Latin-1 section sign). fetch's own
 * text() ignores the header and decodes as UTF-8, which turns any such byte
 * into U+FFFD. Nothing the parser reads has contained one so far, but a label
 * with an accent in it would have arrived broken.
 */
export function decodeBody(body: ArrayBuffer | Uint8Array, contentType: string | null): string {
  const declared = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType ?? "")?.[1];
  if (declared) {
    try {
      return new TextDecoder(declared).decode(body);
    } catch {
      // An encoding label this runtime does not know: fall through.
    }
  }
  return new TextDecoder("utf-8").decode(body);
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

/**
 * A WONDER message as a sentence a visitor can read. CDC's own site turns a
 * trailing "#Age-Adjusted Rates Hints#" into a help link; here it is just noise
 * on the end of the explanation.
 */
function messageText(inner: string): string {
  return decode(
    inner
      // CDC wraps some messages in CDATA and not others. Unwrapped first, for
      // the reason given at caveatText: a tag stripper swallows the whole of
      // an unmarked-up CDATA section, and the message came back empty.
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/#[^#\n]{1,80}#/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/** Detect a WONDER error page and return its message, if any. */
export function extractError(xml: string): string | null {
  const em = xml.match(/<message[^>]*error="true"[^>]*>([\s\S]*?)<\/message>/i);
  if (em) return messageText(em[1]);
  if (/<title>\s*Processing Error/i.test(xml)) {
    const msg = xml.match(/<message>([\s\S]*?)<\/message>/i);
    return msg ? messageText(msg[1]) : "WONDER processing error (no detail provided).";
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

/** WONDER's measure numbering, the same in every database: D158.M1, D76.M1... */
const MEASURE_BY_NUMBER: Record<string, MeasureKey> = {
  "1": "deaths",
  "2": "population",
  "3": "crudeRate",
  "4": "ageAdjustedRate",
};

/**
 * The measure columns this response actually contains, in order, as CDC
 * declares them in <measure-selections-all>. Null when the response does not
 * say. An entry is null for a measure this app has no column for; its cell
 * still has to be stepped over to keep the rest aligned.
 *
 * Asking for a measure is not the same as getting it. Grouping the provisional
 * file by the 15-group race classification returns deaths and nothing else:
 * no population, no rate, no "Not Applicable" placeholder, no caveat. The
 * parser used to assume the measures it had asked for were the ones that came
 * back, and read cells by position on that assumption; here that left two
 * blank columns, and anywhere CDC dropped a measure from the MIDDLE of the
 * list it would have filed every later value under the wrong heading.
 */
export function returnedMeasures(xml: string): (MeasureKey | null)[] | null {
  const response = xml.match(/<response\b[^>]*>([\s\S]*)<\/response>/);
  const block = (response ? response[1] : xml).match(
    /<measure-selections-all\b[^>]*>([\s\S]*?)<\/measure-selections-all>/,
  );
  if (!block) return null;
  const out: (MeasureKey | null)[] = [];
  const re = /<measure\b[^>]*\bcode="[^".]*\.M(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block[1]))) out.push(MEASURE_BY_NUMBER[m[1]] ?? null);
  return out.length > 0 ? out : null;
}

export function parseResponse(xml: string, spec: QuerySpec): ResultTable {
  const VARIABLE_BY_KEY = variableByKey(getDatabase(spec.database));
  const dimKeys = spec.groupBy.slice(0, 5);
  const dimCount = dimKeys.length;
  // What CDC says it sent, where it says; otherwise what was asked for.
  const cellMeasures: (MeasureKey | null)[] = returnedMeasures(xml) ?? measureColumns(spec);
  const measures = cellMeasures.filter((m): m is MeasureKey => m !== null);

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
    return projectMeasures({ columns, rows, rowIsTotal, caveats, rowCount: 0 }, spec);
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

    // Measure columns (value from `v=` on data rows, `dt=` on total rows). A
    // measure with no column here still consumes its cell.
    for (const measure of cellMeasures) {
      const cell = measureQueue.shift();
      if (measure === null) continue;
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
  return projectMeasures({ columns, rows, rowIsTotal, caveats, rowCount: dataCount }, spec);
}

/**
 * WONDER requires M1-M3 (deaths, population, crude rate) on every request, so
 * the response always carries them and the parser must read all of them to
 * stay aligned with the response cells. The user's measure checkboxes, though,
 * are about what they want to SEE — before this, unticking Population or Crude
 * Rate had no effect at all. Drop the unrequested measure columns here, after
 * parsing. Deaths is always kept: it is the primary measure (its checkbox is
 * fixed on in the UI) and the chi-square test uses it for cell weights.
 */
function projectMeasures(table: ResultTable, spec: QuerySpec): ResultTable {
  const wanted = new Set(spec.measures ?? []);
  const keep = table.columns.map(
    (c) =>
      c.kind !== "measure" ||
      c.measureKey === "deaths" ||
      (c.measureKey !== undefined && wanted.has(c.measureKey)),
  );
  if (keep.every(Boolean)) return table;
  return {
    ...table,
    columns: table.columns.filter((_, i) => keep[i]),
    rows: table.rows.map((row) => row.filter((_, i) => keep[i])),
  };
}

/** Links inside a caveat are relative to WONDER's own site. */
const WONDER_ORIGIN = "https://wonder.cdc.gov";

/**
 * One caveat's content as plain text.
 *
 * CDC wraps the text in CDATA and writes it as HTML. The CDATA wrapper has to
 * come off BEFORE tags are stripped: `<![CDATA[` opens with `<`, so a tag
 * stripper run over the raw content treats everything up to the first `>` as
 * one tag. A caveat with no markup inside lost its entire text that way, and
 * one with a link kept only the words after it ("More information. ]]>").
 *
 * A link is kept as its label followed by its address, because "documented
 * here: More information." says nothing once the link is gone.
 */
function caveatText(inner: string): string {
  const html = inner.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const linked = html.replace(
    /<a\b[^>]*?\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, label: string) => {
      try {
        return `${label} (${new URL(decode(href), WONDER_ORIGIN).href})`;
      } catch {
        return label;
      }
    },
  );
  return decode(linked.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

/**
 * The caveats CDC attached to THIS result.
 *
 * A response contains <caveat> elements in two places, and only one of them is
 * what it looks like:
 *
 *   <dataset> ... <caveat code="D158.C10"><text>...</text><rule>wonder:cmf-5()</rule></caveat>
 *     Definitions: every caveat the database could ever raise (about forty),
 *     each with the rule CDC's own site evaluates to decide whether it applies.
 *
 *   <response> ... <caveats><caveat><![CDATA[...]]></caveat></caveats>
 *     The handful that do apply to this query, already resolved to text.
 *
 * Reading every <caveat> in the document put the definitions on screen as if
 * they were CDC's notes on the result, rule expressions and all. So the search
 * is confined to the <caveats> block, and where a document has none, anything
 * shaped like a definition is skipped.
 */
export function extractCaveats(xml: string): string[] {
  const response = xml.match(/<response\b[^>]*>([\s\S]*)<\/response>/);
  const block = (response ? response[1] : xml).match(
    /<caveats\b[^>]*>([\s\S]*?)<\/caveats>/,
  );
  const scope = block ? block[1] : xml;

  const out: string[] = [];
  const re = /<caveat\b([^>]*)>([\s\S]*?)<\/caveat>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scope))) {
    const isDefinition = /\bcode="/.test(m[1]) || /<rule\b/.test(m[2]);
    if (isDefinition) continue;
    const text = caveatText(m[2]);
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}
