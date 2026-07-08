// POST /api/nl — natural-language query box. Translates a plain-English
// request into a QuerySpec using the Gemini API (free tier), grounded on the
// real variable/value registry so it can't invent nonexistent keys or codes.
// The result is validated the same way the manual query builder's spec is
// validated by /api/wonder, so a bad LLM output fails safely with a message
// instead of silently producing a broken query.

import { NextRequest, NextResponse } from "next/server";
import type { MeasureKey, QuerySpec } from "@/lib/wonder/types";
import { DATABASE_ID, VARIABLE_BY_KEY } from "@/lib/wonder/databases";
import { buildSchemaContext } from "@/lib/wonder/schemaContext";

export const runtime = "nodejs";

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

function normalizeLlmOutput(raw: LlmRawOutput): LlmOutput {
  const filters: Record<string, string[]> = {};
  for (const f of raw.filters ?? []) {
    if (f?.key && Array.isArray(f.values) && f.values.length > 0) {
      filters[f.key] = f.values;
    }
  }
  return { groupBy: raw.groupBy, measures: raw.measures, filters, chartType: raw.chartType, summary: raw.summary };
}

function buildPrompt(userText: string): string {
  return `You translate a plain-English request about US mortality data into a structured query
against the CDC WONDER "Underlying Cause of Death, 2018-2024, Single Race" database.

${buildSchemaContext()}

Rules:
- groupBy: ordered list of variable keys to group results by (max 5). Put the most important grouping first (e.g. the thing being trended/compared).
- measures: subset of ["deaths","population","crudeRate","ageAdjustedRate"]. Default to ["deaths"] unless rates are implied.
- filters: array of {key, values} pairs restricting variable key -> value codes. Use "year" with 4-digit year strings for date ranges (e.g. ["2019","2020","2021","2022","2023","2024"]). Omit a key entirely if the user didn't restrict it (don't include an entry with empty values).
- chartType: one of line, bar, stackedBar, horizontalBar, area, scatter, bubble, pie, donut, heatmap, treemap, sunburst, scatter3d — pick whichever best matches what the user described (e.g. "trend over time" -> line). Omit if no figure was requested.
- summary: one short sentence in plain English restating what query you built, for the user to confirm.
- Only use variable keys and value codes that appear in the schema above. Never invent a key or code.
- Respect the one-cause-of-death-framework-per-query rule.

User request: """${userText}"""

Return only the JSON object described by the schema.`;
}

function isMeasureKey(k: string): k is MeasureKey {
  return ["deaths", "population", "crudeRate", "ageAdjustedRate"].includes(k);
}

function validateAndBuildSpec(out: LlmOutput): { spec: QuerySpec; warnings: string[] } | { error: string } {
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

  const measures = (out.measures ?? []).filter(isMeasureKey);
  if (measures.length === 0) measures.push("deaths");

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
    } else {
      // finder (e.g. year, ucdCause): pass through as-is (free-text codes)
      filters[key] = codes;
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
    database: DATABASE_ID,
    groupBy,
    measures,
    filters,
    options: { showTotals: true, showZeros: true, showSuppressed: true, ratePer: 100000 },
  };
  return { spec, warnings };
}

export async function POST(req: NextRequest) {
  const maybeKey = apiKey();
  if (!maybeKey) {
    return NextResponse.json(
      { ok: false, error: "Natural-language queries are not configured. Set GEMINI_API_KEY to enable this feature." },
      { status: 501 },
    );
  }
  const key: string = maybeKey;

  let text: string;
  try {
    const body = await req.json();
    text = String(body?.text ?? "").trim();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ ok: false, error: "Please enter a question or request." }, { status: 400 });
  }

  // Gemini's free tier occasionally returns transient 503 ("high demand"); a
  // couple of short retries smooth this over for the user rather than failing
  // the whole request on a blip.
  async function callGemini(): Promise<Response> {
    let lastRes: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 800 * attempt));
      const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(text) }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            temperature: 0.1,
          },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok || res.status !== 503) return res;
      lastRes = res;
    }
    return lastRes!;
  }

  let llmOut: LlmOutput;
  try {
    const res = await callGemini();
    if (!res.ok) {
      const errText = await res.text();
      const busy = res.status === 503 ? " Gemini is temporarily overloaded — please try again in a moment." : "";
      return NextResponse.json(
        { ok: false, error: `Gemini API error (HTTP ${res.status}): ${errText.slice(0, 300)}${busy}` },
        { status: 502 },
      );
    }
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      return NextResponse.json({ ok: false, error: "Gemini returned no usable response. Try rephrasing." }, { status: 502 });
    }
    llmOut = normalizeLlmOutput(JSON.parse(raw));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `Could not reach Gemini: ${msg}` }, { status: 502 });
  }

  const result = validateAndBuildSpec(llmOut);
  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  }

  return NextResponse.json({
    ok: true,
    spec: result.spec,
    chartType: llmOut.chartType,
    summary: llmOut.summary,
    warnings: result.warnings,
  });
}
