// POST /api/insights — an analytical read of the current result table.
//
// The pipeline is deliberately one-way on numbers:
//
//   table -> buildFactSheet()   exact figures, computed here, no model
//         -> renderFactSheet()  the same figures as text
//         -> Gemini             writes the analysis, using those figures
//         -> verifyStatements() every number it wrote is checked back against
//                               the fact sheet; anything unaccountable is
//                               dropped before the user sees it
//
// So the model chooses what is worth saying and how to say it, and never
// supplies a statistic. If the key is missing, or the model is unavailable, the
// client still has the deterministic bullets from lib/insights.ts.

import { NextRequest, NextResponse } from "next/server";
import type { QuerySpec, ResultTable } from "@/lib/wonder/types";
import { buildFactSheet, keyFigures, renderFactSheet } from "@/lib/analysis/facts";
import { buildAllowSet, verifyStatements } from "@/lib/analysis/verify";
import { pointsFromFacts } from "@/lib/insights";

export const runtime = "nodejs";

// Models in preference order. Google retires model ids without warning (this
// route was pinned to gemini-2.5-flash until it stopped serving new callers
// with a 404), so a retirement now falls through to the next id instead of
// taking the feature down. Pinned ids rather than a floating alias, so the
// behaviour only changes when this list does.
const GEMINI_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash-lite"];
const modelUrl = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    bullets: { type: "array", items: { type: "string" } },
    caveats: { type: "array", items: { type: "string" } },
  },
  required: ["headline", "bullets"],
};

// The site is public and this endpoint spends the deployment's Gemini quota.
const MAX_ROWS = 2000;

export async function GET() {
  return NextResponse.json({ enabled: Boolean(process.env.GEMINI_API_KEY) });
}

function buildPrompt(factSheet: string): string {
  return `You are a mortality-data analyst helping a public health researcher understand a table they just pulled from CDC WONDER. Write the analysis that a thoughtful colleague would give after looking at it.

Below is a FACT SHEET containing exact figures computed directly from the returned table, followed by the table itself. Everything you write must be built from these numbers.

===== FACT SHEET =====
${factSheet}
===== END FACT SHEET =====

Write:

1. "headline" — one sentence, under 25 words, naming the single most important thing in this table. Include the figure that makes the point.

2. "bullets" — 4 to 6 observations, each one or two sentences. This is the substance, so make each one earn its place. Prioritise, in roughly this order:
   - The dominant pattern, with the numbers that establish it.
   - Anything where rates and counts disagree, or where a group's share is out of proportion to its size. These are the observations a reader cannot get by skimming.
   - When the fact sheet gives an AGE-ADJUSTED line for a breakdown, compare groups on that, not on the crude rate: groups with different age structures are not comparable on crude rates. Say "age-adjusted" when you use it. If crude and age-adjusted point at different groups, that difference is itself worth a bullet.
   - Direction and size of change over time, including where the change is uneven across categories.
   - Specific contrasts: how much larger, what multiple, what share. Use the ratios and expected-vs-observed figures from the fact sheet where they exist.
   - Anything genuinely surprising given the rest of the table.
   Every bullet must cite at least one exact figure. Say what the number is, then what it means for the reader.

3. "caveats" — 0 to 2 short notes, only where a caveat materially changes how the numbers should be read (suppressed cells hiding deaths from a total, unreliable rates, or a comparison resting on crude rates because no age-adjusted figure was available). Do NOT raise the age-adjustment caveat when the fact sheet supplied age-adjusted rates and you used them. Skip this section entirely if there is nothing important to flag.

Hard rules:
- Use ONLY numbers that appear in the fact sheet, or a ratio/difference/percent change between two figures that appear there. Never estimate, extrapolate, or recompute a rate from scratch. Numbers that cannot be traced back to the fact sheet are removed automatically, so an invented figure costs you the whole sentence.
- Copy figures as given. Do not re-round a rate or drop a digit from a count.
- Describe the data, do not explain it. No causal claims, no attributing a trend to policy, the pandemic, or any other outside event unless the fact sheet contains it. "Deaths rose 14%" is right; "deaths rose 14% because of X" is not.
- These are real deaths, often by suicide. Use plain, respectful, person-first language. No "spike", "alarming", "epidemic", "surge", "skyrocketed", or any word that editorialises. State magnitudes numerically instead.
- Do not recommend interventions or policy.
- Refer to categories exactly as the fact sheet names them.
- Plain prose in each string. No markdown, no leading bullet characters, no numbering.`;
}

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;

  let table: ResultTable;
  let spec: QuerySpec | undefined;
  try {
    const body = await req.json();
    table = body?.table;
    spec = body?.spec;
    if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
      throw new Error("no table");
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  if (table.rows.length > MAX_ROWS) {
    return NextResponse.json(
      { ok: false, error: "That result is too large to analyze. Narrow the query and try again." },
      { status: 413 },
    );
  }

  const facts = buildFactSheet(table, spec);
  const factSheet = renderFactSheet(facts);

  if (!key) {
    return NextResponse.json(
      { ok: false, error: "AI analysis is not configured. Set GEMINI_API_KEY to enable it." },
      { status: 501 },
    );
  }

  const body = JSON.stringify({
    contents: [{ parts: [{ text: buildPrompt(factSheet) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.4,
    },
  });

  try {
    let res: Response | null = null;
    let model = GEMINI_MODELS[0];
    outer: for (const candidate of GEMINI_MODELS) {
      model = candidate;
      // Gemini's free tier returns 503 under load; a short backoff clears it.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 800 * attempt));
        res = await fetch(`${modelUrl(candidate)}?key=${encodeURIComponent(key)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(45_000),
        });
        if (res.ok) break outer;
        // 404 means this model id is gone — move on rather than retrying it.
        if (res.status === 404) break;
        if (res.status !== 503) break outer;
      }
    }
    if (!res || !res.ok) {
      const detail = res ? await res.text() : "no response";
      const busy =
        res?.status === 503 ? " Gemini is temporarily overloaded — try again in a moment." : "";
      return NextResponse.json(
        {
          ok: false,
          error: `Gemini API error (HTTP ${res?.status ?? "?"}): ${detail.slice(0, 200)}${busy}`,
        },
        { status: 502 },
      );
    }

    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      return NextResponse.json(
        { ok: false, error: "Gemini returned no usable response." },
        { status: 502 },
      );
    }

    const parsed = JSON.parse(raw) as {
      headline?: unknown;
      bullets?: unknown;
      caveats?: unknown;
    };
    const asStrings = (v: unknown) =>
      Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : [];

    const headline = typeof parsed.headline === "string" ? parsed.headline.trim() : "";
    const bullets = asStrings(parsed.bullets);
    const caveats = asStrings(parsed.caveats);

    // Every figure the model wrote must be accountable to the fact sheet.
    const allow = buildAllowSet(factSheet, keyFigures(facts));
    const headlineCheck = verifyStatements(headline ? [headline] : [], allow);
    const bulletCheck = verifyStatements(bullets, allow);
    const caveatCheck = verifyStatements(caveats, allow);
    const allDropped = [
      ...headlineCheck.dropped,
      ...bulletCheck.dropped,
      ...caveatCheck.dropped,
    ];
    const dropped = allDropped.length;
    // Logged, not silent: a run that keeps dropping statements means the prompt
    // or the fact sheet needs work, and there is no other way to see it.
    for (const d of allDropped) {
      console.warn(
        `[insights] dropped unverifiable figure(s) ${d.figures.join(", ")} in: ${d.text.slice(0, 160)}`,
      );
    }

    if (bulletCheck.kept.length === 0) {
      // Nothing survived — fall back rather than show an empty panel.
      return NextResponse.json({
        ok: true,
        headline: "",
        bullets: pointsFromFacts(facts),
        caveats: [],
        dropped,
        fellBack: true,
        model,
      });
    }

    return NextResponse.json({
      ok: true,
      headline: headlineCheck.kept[0] ?? "",
      bullets: bulletCheck.kept,
      caveats: caveatCheck.kept,
      dropped,
      fellBack: false,
      model,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `Could not reach Gemini: ${msg}` }, { status: 502 });
  }
}
