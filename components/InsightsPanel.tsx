"use client";

// "Talking points" for the current result — generated with rule-based logic (no
// AI needed). The "Enhance with AI" button is a seam: it lights up only when an
// ANTHROPIC_API_KEY is configured (checked via /api/nl) and otherwise explains
// how to enable a future AI-polished version.

import { useEffect, useMemo, useState } from "react";
import type { ResultTable } from "@/lib/wonder/types";
import { talkingPoints } from "@/lib/insights";

export default function InsightsPanel({ table }: { table: ResultTable }) {
  const points = useMemo(() => talkingPoints(table), [table]);
  const [aiEnabled, setAiEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/nl").then((r) => r.json()).then((d) => setAiEnabled(Boolean(d.enabled))).catch(() => {});
  }, []);

  return (
    <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">Talking points</h3>
        <button
          type="button"
          disabled={!aiEnabled}
          title={aiEnabled ? "Polish these with AI" : "Set ANTHROPIC_API_KEY to enable AI-polished talking points"}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          ✨ Enhance with AI{aiEnabled ? "" : " (needs API key)"}
        </button>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
        {points.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-400">
        Auto-generated from the data. Verify against the table before quoting.
      </p>
    </div>
  );
}
