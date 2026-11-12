// POST /api/nl — natural-language query box. Translates a plain-English
// request into a QuerySpec using the Gemini API (free tier), grounded on the
// real variable/value registry so it can't invent nonexistent keys or codes.
// The result is validated the same way the manual query builder's spec is
// validated by /api/wonder, so a bad LLM output fails safely with a message
// instead of silently producing a broken query.

import { NextRequest, NextResponse } from "next/server";
import type { MeasureKey, QuerySpec } from "@/lib/wonder/types";
import { getDatabase, variableByKey } from "@/lib/wonder/db/registry";
import { buildSchemaContext } from "@/lib/wonder/schemaContext";
import { logQuery } from "@/lib/queryLog";
import { callGemini, geminiModelChain, geminiText } from "@/lib/geminiCall";
import { quotaMessage } from "@/lib/geminiQuota";

export const runtime = "nodejs";

// Which models, in what order, and what happens when one fails: lib/geminiCall.ts.
const GEMINI_MODELS = geminiModelChain(process.env.GEMINI_MODEL);
const MAX_PROMPT_CHARS = 2000;

function apiKey(): string | null {
  return process.env.GEMINI_API_KEY || null;
}

export async function GET() {
  return NextResponse.json({ enabled: Boolean(apiKey()) });
}

// Gemini's structured-output schema is a restricted OpenAPI subset that does
// NOT support `additionalProperties` (dynamic-key objects). So filters are
// represented as an array of {key, values} pairs instead of a free-form
// object, and converted back to a Record after parsing.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    groupBy: { type: "array", items: { type: "string" } },
    measures: { type: "array", items: { type: "string" } },
    filters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          values: { type: "array", items: { type: "string" } },
        },
        required: ["key", "values"],
      },
    },
    chartType: { type: "string" },
    summary: { type: "string" },
  },
  required: ["groupBy", "measures", "filters", "summary"],
};

interface LlmRawOutput {
  groupBy: string[];
  measures: string[];
  filters: { key: string; values: string[] }[];
  chartType?: string;
  summary: string;
}

interface LlmOutput {
  groupBy: string[];
  measures: string[];
  filters: Record<string, string[]>;
  chartType?: string;
  summary: string;
}

// The schema asks for these shapes, but a model's output is still only text
// that usually parses: anything that is not a list of strings is treated as
// absent rather than trusted.
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function normalizeLlmOutput(raw: LlmRawOutput): LlmOutput {
  const filters: Record<string, string[]> = {};
  for (const f of Array.isArray(raw.filters) ? raw.filters : []) {
    const values = strings(f?.values);
    if (typeof f?.key === "string" && f.key && values.length > 0) filters[f.key] = values;
  }
  return {
    groupBy: strings(raw.groupBy),
    measures: strings(raw.measures),
    filters,
    chartType: typeof raw.chartType === "string" ? raw.chartType : undefined,
    summary: typeof raw.summary === "string" ? raw.summary : "",
  };
}

function buildPrompt(userText: string, databaseId: string): string {
  const db = getDatabase(databaseId);
  return `You translate a plain-English request about US mortality data into a structured query
against the CDC WONDER "${db.label}" database.

${buildSchemaContext(databaseId)}

Rules:
- groupBy: ordered list of variable keys to group results by (max 5). Put the most important grouping first (e.g. the thing being trended/compared).
- measures: subset of ["deaths","population","crudeRate","ageAdjustedRate"]. Default to ["deaths"] unless rates are implied.
- filters: array of {key, values} pairs restricting variable key -> value codes. Use "year" with 4-digit year strings for date ranges (e.g. ["2019","2020","2021","2022","2023","2024"]). Omit a key entirely if the user didn't restrict it (don't include an entry with empty values).
- chartType: one of line, bar, stackedBar, horizontalBar, area, scatter, bubble, pie, donut, heatmap, treemap, sunburst, scatter3d — pick whichever best matches what the user described (e.g. "trend over time" -> line). Omit if no figure was requested.
- summary: one short sentence in plain English restating what query you built, for the user to confirm.
- Only use variable keys and value codes that appear in the schema above. Never invent a key or code.
- Respect the one-cause-of-death-framework-per-query rule.
- COMPARISONS (important): if the user asks to compare a subgroup against the general population or against other groups, you MUST group by that variable and MUST NOT filter it — filtering to the subgroup removes the comparison groups. Example: "suicide rates among AI/AN youth compared to the US general population" -> groupBy includes "race6" (so AI/AN appears alongside the other race groups), filters do NOT contain race6. Only filter a variable when the user wants results restricted to it alone with no comparison.
- Do not add groupings the user did not ask for (e.g. don't add sex unless sex was mentioned).
- AGE RANGES: map requested ages onto the exact codes available. If a requested range (e.g. 10-24) does not align with ten-year group boundaries, use ageFive with the covering five-year codes (e.g. 10-14, 15-19, 20-24) instead of inventing an ageTen code.

User request: """${userText}"""

Return only the JSON object described by the schema.`;
}

function isMeasureKey(k: string): k is MeasureKey {
  return ["deaths", "population", "crudeRate", "ageAdjustedRate"].includes(k);
}

function validateAndBuildSpec(
  out: LlmOutput,
  databaseId: string,
): { spec: QuerySpec; warnings: string[] } | { error: string } {
  // Grounding and validation both follow the dataset the user is looking at:
  // the provisional file has a different variable list and no age-adjusted rate.
  const db = getDatabase(databaseId);
  const VARIABLE_BY_KEY = variableByKey(db);
  const warnings: string[] = [];

  const groupBy = (out.groupBy ?? []).filter((k) => {
    const def = VARIABLE_BY_KEY[k];
    if (!def || !def.canGroup) {
      warnings.push(`Ignored unknown/ungroupable field "${k}".`);
      return false;
    }
    return true;
  });
  if (groupBy.length === 0) return { error: "Could not determine what to group the data by. Try being more specific (e.g. mention a time period or category)." };
  if (groupBy.length > 5) groupBy.length = 5;

  const ageGroups = groupBy.filter((k) => k.startsWith("age"));
  if (ageGroups.length > 1) {
    for (const k of ageGroups.slice(1)) {
      const i = groupBy.indexOf(k);
      if (i >= 0) groupBy.splice(i, 1);
    }
    warnings.push("Only one age grouping is allowed; kept the first.");
  }
  const raceGroups = groupBy.filter((k) => k.startsWith("race"));
  if (raceGroups.length > 1) {
    for (const k of raceGroups.slice(1)) {
      const i = groupBy.indexOf(k);
      if (i >= 0) groupBy.splice(i, 1);
    }
    warnings.push("Only one race grouping is allowed; kept the first.");
  }

  // Deaths is always returned by WONDER and always shown, and the builder pins
  // its checkbox on. Without this, an LLM answer of just ["crudeRate"] left the
  // Deaths box unticked while the table displayed a Deaths column.
  const measures = (out.measures ?? []).filter(isMeasureKey);
  if (!measures.includes("deaths")) measures.unshift("deaths");
  // Population is the denominator the insights engine needs to compute
  // marginal rates, and WONDER returns it regardless of whether it is asked
  // for, so it is always kept.
  if (!measures.includes("population")) measures.splice(1, 0, "population");
  // Age-adjusted rate by default, matching the manual builder. It is dropped
  // downstream when the query groups by age, so asking for it is always safe.
  if (!measures.includes("ageAdjustedRate") && db.measures.includes("ageAdjustedRate")) {
    measures.push("ageAdjustedRate");
  }

  const filters: Record<string, string[]> = {};
  for (const [key, codes] of Object.entries(out.filters ?? {})) {
    const def = VARIABLE_BY_KEY[key];
    if (!def || !def.canFilter) {
      warnings.push(`Ignored unknown/unfilterable field "${key}".`);
      continue;
    }
    if (!Array.isArray(codes) || codes.length === 0) continue;
    if (def.filterMode === "value") {
      const validCodes = new Set(def.values.map((v) => v.code));
      const kept = codes.filter((c) => validCodes.has(c));
      if (kept.length !== codes.length) {
        warnings.push(`Some values for "${def.label}" weren't recognized and were dropped.`);
      }
      if (kept.length > 0) filters[key] = kept;
    } else if (key === "year") {
      // Years are open-ended to WONDER but not to this dataset. Asked about
      // "the last ten years" against the 2018-2024 file, the model fills in
      // 2015-2017 as well, and CDC refuses the whole query over them.
      const kept = codes.filter((c) => db.years.includes(c));
      if (kept.length !== codes.length) {
        warnings.push(
          `${db.shortLabel} covers ${db.years[0]}–${db.years[db.years.length - 1]}; years outside that were dropped.`,
        );
      }
      if (kept.length > 0) filters[key] = kept;
    } else {
      // Other finders (ICD codes): free-text, passed through as given.
      filters[key] = codes;
    }
  }

  // If a variable is grouped AND filtered to a single value, the grouping is
  // pointless (one category) — the model does this on "compare X to everyone"
  // requests despite prompt rules. Drop the filter so the comparison works.
  // (Exempt cause-framework vars: e.g. injuryIntent=Suicide grouped by
  // mechanism is a legitimate restriction, and time restrictions are fine.)
  for (const k of groupBy) {
    const def = VARIABLE_BY_KEY[k];
    if (!def || def.control?.param === "O_ucd" || k === "year" || k === "month") continue;
    if (filters[k]?.length === 1) {
      const label = def.values.find((v) => v.code === filters[k][0])?.label ?? filters[k][0];
      delete filters[k];
      warnings.push(
        `Showing all ${def.label} groups so "${label}" can be compared against the others.`,
      );
    }
  }

  // Enforce single cause-of-death framework, same rule as /api/wonder.
  const usedKeys = [...groupBy, ...Object.keys(filters)];
  const ucdValues = new Set(
    usedKeys
      .map((k) => VARIABLE_BY_KEY[k]?.control)
      .filter((c) => c?.param === "O_ucd")
      .map((c) => c!.value),
  );
  if (ucdValues.size > 1) {
    return { error: "The request mixes more than one cause-of-death framework (e.g. ICD codes and injury mechanism). Please ask about just one." };
  }

  const spec: QuerySpec = {
    database: db.id,
    groupBy,
    measures,
    filters,
    options: { showTotals: true, showZeros: true, showSuppressed: true, ratePer: 100000 },
  };
  return { spec, warnings };
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const maybeKey = apiKey();
  if (!maybeKey) {
    return NextResponse.json(
      { ok: false, error: "Natural-language queries are not configured. Set GEMINI_API_KEY to enable this feature." },
      { status: 501 },
    );
  }
  const key: string = maybeKey;

  let text: string;
  let databaseId: string;
  try {
    const body = await req.json();
    text = String(body?.text ?? "").trim();
    // The box translates against whichever dataset the user is looking at.
    databaseId = getDatabase(body?.database).id;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ ok: false, error: "Please enter a question or request." }, { status: 400 });
  }
  // The site is public and this endpoint spends the deployment's Gemini quota,
  // so cap the prompt size. A real question about mortality data is nowhere
  // near this long.
  if (text.length > MAX_PROMPT_CHARS) {
    return NextResponse.json(
      { ok: false, error: `That request is too long (${text.length} characters; limit ${MAX_PROMPT_CHARS}). Please shorten it.` },
      { status: 413 },
    );
  }

  const fail = (status: number, error: string, detail?: string) => {
    logQuery(req.headers, {
      kind: "nl",
      ok: false,
      ms: Date.now() - startedAt,
      text,
      error,
      detail,
    });
    return NextResponse.json({ ok: false, error }, { status });
  };

  const call = await callGemini({
    key,
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(text, databaseId) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    }),
    models: GEMINI_MODELS,
    timeoutMs: 30_000,
    tag: "nl",
  });
  if (!call.ok) {
    // What Google said goes to the log. The visitor gets what to do about it:
    // these used to be shown the first 300 characters of the JSON error body.
    const detail = `HTTP ${call.status ?? "none"} from ${call.model}: ${call.detail.slice(0, 300)}`;
    if (call.status === 429) return fail(429, quotaMessage(call.quota, "ask"), detail);
    if (call.status === 503) {
      return fail(
        503,
        "The AI service is temporarily overloaded. Try again in a moment, or use the query builder below.",
        detail,
      );
    }
    return fail(
      502,
      call.status === null
        ? "Could not reach the AI service. Try again in a moment, or use the query builder below."
        : `The plain-English box is unavailable right now (the AI service returned ${call.status}). The query builder below does not need it.`,
      detail,
    );
  }

  let llmOut: LlmOutput;
  try {
    const raw = geminiText(call.data);
    if (!raw) return fail(502, "The AI returned no usable response. Try rephrasing.", "empty response");
    const parsed = JSON.parse(raw) as LlmRawOutput | null;
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    llmOut = normalizeLlmOutput(parsed);
  } catch (e) {
    return fail(
      502,
      "The AI returned a response that could not be read. Try rephrasing.",
      `unparseable: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const result = validateAndBuildSpec(llmOut, databaseId);
  if ("error" in result) {
    logQuery(req.headers, {
      kind: "nl",
      ok: false,
      ms: Date.now() - startedAt,
      text,
      error: result.error,
    });
    return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  }

  logQuery(req.headers, {
    kind: "nl",
    ok: true,
    ms: Date.now() - startedAt,
    text,
    groupBy: result.spec.groupBy,
    measures: result.spec.measures,
    filters: result.spec.filters,
  });

  return NextResponse.json({
    ok: true,
    spec: result.spec,
    chartType: llmOut.chartType,
    summary: llmOut.summary,
    warnings: result.warnings,
  });
}
