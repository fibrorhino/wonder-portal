// Converts a QuerySpec into a CDC WONDER `request_xml` document. The base
// parameter set is the exact template verified to return data from the live
// D158 API; group-by, measures, and filters are applied as overrides on top.

import type { MeasureKey, QuerySpec } from "./types";
import { DATABASE_ID, MEASURE_CODES, VARIABLE_BY_KEY } from "./databases";

// Finder variables present in D158 (residence-only set that the API accepts).
const FINDER_VARS = ["V1", "V10", "V2", "V27", "V9"];
// Value variables we set defaults for (superset of what the UI exposes).
const VALUE_VARS = [
  "V11", "V12", "V17", "V18", "V19", "V20", "V21", "V22", "V23", "V24",
  "V28", "V4", "V42", "V43", "V45", "V5", "V51", "V52", "V7",
];

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build the ordered parameter map for a spec. */
function buildParams(spec: QuerySpec): Map<string, string[]> {
  const db = DATABASE_ID;
  const p = new Map<string, string[]>();
  const set = (name: string, ...values: string[]) => p.set(name, values);

  set("accept_datause_restrictions", "true");

  // --- Group-by (B_1..B_5) ---
  const groupBy = spec.groupBy.slice(0, 5);
  for (let i = 0; i < 5; i++) {
    const key = groupBy[i];
    const token = key ? VARIABLE_BY_KEY[key]?.groupToken ?? "*None*" : "*None*";
    set(`B_${i + 1}`, token);
  }

  // --- Measures (M1-M3 mandatory; M4 optional) ---
  const groupingByAge = groupBy.some((k) => k.startsWith("age"));
  const wantsAgeAdjusted =
    spec.measures.includes("ageAdjustedRate") && !groupingByAge;
  set("M_1", MEASURE_CODES.deaths);
  set("M_2", MEASURE_CODES.population);
  set("M_3", MEASURE_CODES.crudeRate);
  if (wantsAgeAdjusted) set("M_4", MEASURE_CODES.ageAdjustedRate);

  // --- Finder defaults ---
  for (const v of FINDER_VARS) {
    set(`F_${db}.${v}`, "*All*");
    set(`O_${v}_fmode`, "freg");
    set(`V_${db}.${v}`, "");
    set(`finder-stage-${db}.${v}`, "codeset");
  }

  // --- Options ---
  set("O_aar", wantsAgeAdjusted ? "aar_std" : "aar_none");
  set("O_aar_pop", "0000");
  set("O_age", `${db}.V5`);
  set("O_dates", "YEAR");
  set("O_javascript", "on");
  set("O_location", `${db}.V9`);
  set("O_oc-sect1-request", "close");
  set("O_precision", "1");
  set("O_race", `${db}.V42`);
  set("O_rate_per", String(spec.options.ratePer ?? 100000));
  set("O_show_totals", spec.options.showTotals === false ? "false" : "true");
  set("O_show_zeros", spec.options.showZeros === false ? "false" : "true");
  set("O_show_suppressed", spec.options.showSuppressed === false ? "false" : "true");
  set("O_timeout", "600");
  set("O_title", "");
  set("O_ucd", `${db}.V2`);
  set("O_urban", `${db}.V19`);

  // --- VM (age-adjust cross vars) ---
  set(`VM_${db}.M6_${db}.V10`, "");
  set(`VM_${db}.M6_${db}.V17`, "*All*");
  set(`VM_${db}.M6_${db}.V1_S`, "*All*");
  set(`VM_${db}.M6_${db}.V42`, "*All*");
  set(`VM_${db}.M6_${db}.V7`, "*All*");

  // --- Value-variable defaults ---
  for (const v of VALUE_VARS) set(`V_${db}.${v}`, v === "V6" ? "00" : "*All*");
  set(`V_${db}.V6`, "00");

  // --- Apply controls for any grouped variable (age/race/cause selectors) ---
  for (const key of groupBy) {
    const def = VARIABLE_BY_KEY[key];
    if (def?.control) set(def.control.param, def.control.value);
  }

  // --- Finder scaffolding for any finder variable used beyond the base set
  // (e.g. drug/alcohol V25, ICD-113 V4). Filters below may override F_ with codes.
  const finderUsed = new Set<string>();
  for (const key of groupBy) {
    const d = VARIABLE_BY_KEY[key];
    if (d?.filterMode === "finder") finderUsed.add(d.varCode);
  }
  for (const [key, codes] of Object.entries(spec.filters)) {
    const d = VARIABLE_BY_KEY[key];
    if (d?.filterMode === "finder" && codes?.length) finderUsed.add(d.varCode);
  }
  for (const vc of finderUsed) {
    const short = vc.split(".")[1];
    if (!p.has(`F_${vc}`)) set(`F_${vc}`, "*All*");
    set(`O_${short}_fmode`, "freg");
    set(`finder-stage-${vc}`, "codeset");
    if (!p.has(`V_${vc}`)) set(`V_${vc}`, "");
  }

  // --- Apply filters ---
  for (const [key, codes] of Object.entries(spec.filters)) {
    if (!codes || codes.length === 0) continue;
    const def = VARIABLE_BY_KEY[key];
    if (!def) continue;
    const varCode = def.varCode; // e.g. D158.V2
    if (def.filterMode === "finder") {
      set(`F_${varCode}`, ...codes);
      set(`I_${varCode}`, codes.join(", "));
      set(`O_${varCode.split(".")[1]}_fmode`, "freg");
      set(`finder-stage-${varCode}`, "codeset");
    } else {
      set(`V_${varCode}`, ...codes);
      if (def.control) set(def.control.param, def.control.value);
    }
  }

  // If month is used, allow month-level dates.
  if (groupBy.includes("month") || spec.filters.month?.length) {
    set("O_dates", "MONTH");
  }

  // --- Control params ---
  set("action-Send", "Send");
  set("dataset_code", db);
  set("dataset_label", "Underlying Cause of Death, by Single-Race Categories");
  set("stage", "request");
  set("saved_id", "");

  return p;
}

export function buildRequestXml(spec: QuerySpec): string {
  const params = buildParams(spec);
  let xml = "<request-parameters>\n";
  for (const [name, values] of params) {
    xml += "<parameter>\n<name>" + escapeXml(name) + "</name>\n";
    if (values.length === 0) {
      xml += "<value></value>\n";
    } else {
      for (const v of values) xml += "<value>" + escapeXml(v) + "</value>\n";
    }
    xml += "</parameter>\n";
  }
  xml += "</request-parameters>";
  return xml;
}

/** Which measure columns the response will contain, in order. */
export function measureColumns(spec: QuerySpec): MeasureKey[] {
  const groupingByAge = spec.groupBy.some((k) => k.startsWith("age"));
  const cols: MeasureKey[] = ["deaths", "population", "crudeRate"];
  if (spec.measures.includes("ageAdjustedRate") && !groupingByAge) {
    cols.push("ageAdjustedRate");
  }
  return cols;
}
