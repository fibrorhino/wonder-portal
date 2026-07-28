"use client";

// "Talking points" for the current result. The bullets are computed
// deterministically from the table (lib/insights.ts) so every number is exact;
// the optional "Enhance with AI" pass only rewrites them for tone and clarity
// via /api/insights (Gemini), and can be reverted.

import { useEffect, useMemo, useState } from "react";
import type { QuerySpec, ResultTable } from "@/lib/wonder/types";
import { talkingPoints } from "@/lib/insights";
import { describeFilters, describeGrouping } from "@/lib/describeSpec";
import { safeJson } from "@/lib/safeJson";

export default function InsightsPanel({
  table,
  spec,
}: {
  table: ResultTable;
  spec?: QuerySpec;
}) {
  const basePoints = useMemo(() => talkingPoints(table), [table]);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiPoints, setAiPoints] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new result invalidates any previous AI rewrite.
  useEffect(() => {
    setAiPoints(null);
    setError(null);
  }, [table]);

  useEffect(() => {
    fetch("/api/insights")
      .then((r) => r.json())
      .then((d) => setAiEnabled(Boolean(d.enabled)))
      .catch(() => setAiEnabled(false));
  }, []);

  const enhance = async () => {
    setLoading(true);
    setError(null);
    try {
      const context = spec
        ? `${describeGrouping(spec)} — ${describeFilters(spec)}`
        : "";
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: basePoints, context }),
      });
      const parsed = await safeJson<{ ok: boolean; points?: string[]; error?: string }>(res);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      if (!parsed.data.ok) {
        setError(parsed.data.error ?? "Could not enhance the talking points.");
        return;
      }
      setAiPoints(parsed.data.points ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setLoading(false);
    }
  };

  const points = aiPoints ?? basePoints;

  return (
    <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">
          Talking points
          {aiPoints && (
            <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
              AI-polished
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {aiPoints && (
            <button
              type="button"
              onClick={() => setAiPoints(null)}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-white"
            >
              Revert
            </button>
          )}
          <button
            type="button"
            onClick={enhance}
            disabled={!aiEnabled || loading}
            title={
              aiEnabled
                ? "Rewrite these for tone and clarity (numbers are preserved exactly)"
                : "Set GEMINI_API_KEY to enable AI-polished talking points"
            }
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Polishing…" : `✨ Enhance with AI${aiEnabled ? "" : " (needs API key)"}`}
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}

      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
        {points.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-400">
        {aiPoints
          ? "Rewritten by AI from the computed figures; numbers are unchanged. Verify against the table before quoting."
          : "Auto-generated from the data. Verify against the table before quoting."}
      </p>
    </div>
  );
}
