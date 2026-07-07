// POST /api/nl — future seam for the natural-language query box. When an
// ANTHROPIC_API_KEY is configured, this route will call the Claude API to
// translate a natural-language request into a QuerySpec (+ chart/stat
// directives) and return it. Until then it reports "not configured" so the UI
// can show the box in a disabled state.

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ enabled: Boolean(process.env.ANTHROPIC_API_KEY) });
}

export async function POST() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Natural-language queries are not configured yet. Set ANTHROPIC_API_KEY to enable this feature.",
      },
      { status: 501 },
    );
  }
  // Placeholder until the LLM interpreter is implemented.
  return NextResponse.json(
    { ok: false, error: "Natural-language interpreter not implemented yet." },
    { status: 501 },
  );
}
