// POST /api/insights — polish the rule-based talking points with Gemini.
//
// The deterministic bullets from lib/insights.ts are computed from the actual
// table and are the ONLY source of numbers; the model is asked to rewrite them
// for tone/readability and add framing, never to invent or recompute figures.
// This keeps the statistics trustworthy while improving the prose.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    points: { type: "array", items: { type: "string" } },
  },
  required: ["points"],
};

export async function GET() {
  return NextResponse.json({ enabled: Boolean(process.env.GEMINI_API_KEY) });
}

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "AI enhancement is not configured. Set GEMINI_API_KEY to enable it." },
      { status: 501 },
    );
  }

  let points: string[];
  let context: string;
  try {
    const body = await req.json();
    points = Array.isArray(body?.points) ? body.points.map(String) : [];
    context = String(body?.context ?? "");
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  if (points.length === 0) {
    return NextResponse.json({ ok: false, error: "No talking points to enhance." }, { status: 400 });
  }
  // The site is public and this endpoint spends the deployment's Gemini quota.
  // lib/insights.ts emits at most 6 short bullets, so anything past these
  // bounds is not a real request from the app.
  const totalChars = points.reduce((n, p) => n + p.length, 0) + context.length;
  if (points.length > 12 || totalChars > 6000) {
    return NextResponse.json(
      { ok: false, error: "Too much text to enhance." },
      { status: 413 },
    );
  }

  const prompt = `You are helping a public health researcher present CDC mortality data.

Below are factual talking points computed directly from the data table. Rewrite them as clear,
publication-ready bullet points for a presentation or report.

Query context: ${context || "(not specified)"}

Talking points:
${points.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Rules — these matter:
- NEVER change, recompute, round differently, or invent any number, percentage, year, or category name. Every figure must appear exactly as given.
- Do not add claims, causes, explanations, or comparisons that are not supported by the points above. No speculation about WHY a trend occurred.
- Improve clarity, flow, and professional tone. Combine closely related points if it reads better.
- This is mortality data, often involving suicide. Use respectful, person-first, non-sensational language. Avoid words like "spike", "alarming", "epidemic", or anything that reads as editorializing.
- Keep each bullet to one or two sentences. Return between 3 and 6 bullets.
- Plain text only — no markdown bullets, bold, or numbering in the strings themselves.`;

  try {
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 800 * attempt));
      res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            temperature: 0.3,
          },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok || res.status !== 503) break;
    }
    if (!res || !res.ok) {
      const detail = res ? await res.text() : "no response";
      const busy = res?.status === 503 ? " Gemini is temporarily overloaded — try again in a moment." : "";
      return NextResponse.json(
        { ok: false, error: `Gemini API error (HTTP ${res?.status ?? "?"}): ${detail.slice(0, 200)}${busy}` },
        { status: 502 },
      );
    }
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      return NextResponse.json({ ok: false, error: "Gemini returned no usable response." }, { status: 502 });
    }
    const parsed = JSON.parse(raw) as { points?: unknown };
    const enhanced = Array.isArray(parsed.points)
      ? parsed.points.map(String).filter((s) => s.trim().length > 0)
      : [];
    if (enhanced.length === 0) {
      return NextResponse.json({ ok: false, error: "Gemini returned no talking points." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, points: enhanced });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `Could not reach Gemini: ${msg}` }, { status: 502 });
  }
}
