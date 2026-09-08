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

import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { QuerySpec, ResultTable } from "@/lib/wonder/types";
import { buildFactSheet, keyFigures, renderFactSheet } from "@/lib/analysis/facts";
import { buildAllowSet, verifyStatements } from "@/lib/analysis/verify";
import { pointsFromFacts } from "@/lib/insights";
import { createCache } from "@/lib/cache";

export const runtime = "nodejs";

// Models in preference order. Google retires model ids without warning (this
// route was pinned to gemini-2.5-flash until it stopped serving new callers
// with a 404), so a retirement now falls through to the next id instead of
// taking the feature down. Pinned ids rather than a floating alias, so the
// behaviour only changes when this list does.
//
// Flash-Lite leads: this site is public and runs on the free tier, and the
// model is not doing the arithmetic — every figure is supplied by the fact
// sheet and checked afterwards — so the cheaper model with the higher quota is
// the right default. GEMINI_MODEL overrides it without a code change.
const DEFAULT_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-3.6-flash",
];
const GEMINI_MODELS = process.env.GEMINI_MODEL
  ? [process.env.GEMINI_MODEL, ...DEFAULT_MODELS.filter((m) => m !== process.env.GEMINI_MODEL)]
  : DEFAULT_MODELS;
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

// Analyses are cached on the fact sheet, which is the model's entire input:
// identical input means an identical answer, so ten people opening the same
// shared link cost one API call rather than ten. Keying on the fact sheet
// rather than the spec also collapses different specs that happen to produce
// the same figures. A day, because the underlying data is annual vintages.
const analysisCache = createCache<AnalysisResult>({
  ttlMs: 1000 * 60 * 60 * 24,
  maxEntries: 300,
});

interface AnalysisResult {
  headline: string;
  bullets: string[];
  caveats: string[];
  dropped: number;
  fellBack: boolean;
  model: string;
}

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

   Do NOT simply walk the table. A bullet that reports one category's figures and stops is a wasted bullet — the reader can already see the table. Each one should carry a comparison, a share, a ratio, a direction of change, or a contrast between two things. If you cannot say why a number matters, leave it out.

   Never write about a category with zero deaths, an empty population, or a label like "Not Available", "Not Stated" or "Unknown" — not in a bullet, not in a caveat, not in the headline. Those are placeholders in the coding scheme, not findings.

3. "caveats" — 0 to 2 short notes, only where a caveat materially changes how the numbers should be read (suppressed cells hiding deaths from a total, unreliable rates, or a comparison resting on crude rates because no age-adjusted figure was available). Do NOT raise the age-adjustment caveat when the fact sheet supplied age-adjusted rates and you used them. Skip this section entirely if there is nothing important to flag.

Hard rules:
- Use ONLY numbers that appear in the fact sheet, or a ratio/difference/percent change between two figures that appear there. Never estimate, extrapolate, or recompute a rate from scratch. Numbers that cannot be traced back to the fact sheet are removed automatically, so an invented figure costs you the whole sentence.
- Copy figures as given. Do not re-round a rate or drop a digit from a count.
- Never mix figures across the CRUDE and AGE-ADJUSTED lines. Each line carries its own highest, lowest and ratio; if you quote age-adjusted rates, the ratio must be the AGE-ADJUSTED ratio from that same line, not the crude one. Both are real numbers, so this is not caught automatically — a sentence pairing age-adjusted rates with the crude ratio is simply wrong.
- Name the measure you are quoting. A figure from the AGE-ADJUSTED line is an age-adjusted rate and must never be called a crude rate, and vice versa.
- Describe the data, do not explain it. No causal claims, no attributing a trend to policy, the pandemic, or any other outside event unless the fact sheet contains it. "Deaths rose 14%" is right; "deaths rose 14% because of X" is not.
- These are real deaths, often by suicide. Use plain, respectful, person-first language. No "spike", "alarming", "epidemic", "surge", "skyrocketed", or any word that editorialises. State magnitudes numerically instead.
- Do not recommend interventions or policy.
- Refer to categories exactly as the fact sheet names them.
- Plain prose in each string. No markdown, no leading bullet characters, no numbering.
- Return at most 6 bullets. Fewer, sharper bullets are better than a complete inventory.`;
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

  // The prompt is a pure function of the fact sheet, so the fact sheet is the
  // cache key. Hashed rather than stored whole: these run to ~11 KB.
  const cacheKey = createHash("sha256").update(factSheet).digest("hex");
  const hit = analysisCache.get(cacheKey);
  if (hit) {
    return NextResponse.json({ ok: true, ...hit, cached: true });
  }

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
        // 429 is the project's daily free-tier quota, shared across every
        // model, so trying another one or waiting a second achieves nothing.
        if (res.status === 429) break outer;
        if (res.status !== 503) break outer;
      }
    }
    if (!res || !res.ok) {
      const detail = res ? await res.text() : "no response";
      // A raw API error blob tells the reader nothing they can act on, and the
      // two cases that actually happen have different answers: wait a moment,
      // or wait until tomorrow.
      if (res?.status === 429) {
        return NextResponse.json(
          {
            ok: false,
            // The free tier enforces both a per-minute and a per-day limit and
            // returns 429 for either, without saying which — so the message
            // must not claim to know. In practice it is almost always the
            // per-minute one and clears on its own.
            error:
              "AI analysis is rate-limited right now. This usually clears within a minute — try again shortly. If it keeps happening, the daily free-tier limit has been reached and resets at midnight Pacific. The talking points below are computed directly from the data and do not need the AI.",
          },
          { status: 429 },
        );
      }
      if (res?.status === 503) {
        return NextResponse.json(
          { ok: false, error: "The AI service is temporarily overloaded. Try again in a moment." },
          { status: 503 },
        );
      }
      return NextResponse.json(
        {
          ok: false,
          error: `AI analysis failed (HTTP ${res?.status ?? "?"}): ${detail.slice(0, 200)}`,
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
    // The response schema cannot express a maximum length, and the smaller
    // models in particular will happily enumerate every row.
    const bullets = asStrings(parsed.bullets).slice(0, 6);
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

    const result: AnalysisResult =
      bulletCheck.kept.length === 0
        ? {
            // Nothing survived verification — fall back rather than show an
            // empty panel. Cached too: the same fact sheet would fail the same
            // way, and retrying would just spend another call to find out.
            headline: "",
            bullets: pointsFromFacts(facts),
            caveats: [],
            dropped,
            fellBack: true,
            model,
          }
        : {
            headline: headlineCheck.kept[0] ?? "",
            bullets: bulletCheck.kept,
            caveats: caveatCheck.kept,
            dropped,
            fellBack: false,
            model,
          };

    analysisCache.set(cacheKey, result);
    return NextResponse.json({ ok: true, ...result, cached: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `Could not reach Gemini: ${msg}` }, { status: 502 });
  }
}
