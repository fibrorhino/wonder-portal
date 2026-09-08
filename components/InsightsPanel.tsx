"use client";

// Talking points for the current result.
//
// Two tiers, both built on the same deterministic fact sheet:
//   - the default bullets are computed by the page (lib/insights.ts), so every
//     figure is exact and they appear instantly;
//   - "Analyze with AI" asks /api/insights for a written read of the same
//     figures. That route verifies every number the model returns against the
//     fact sheet before responding, so the analysis can add judgement about
//     what matters without being able to add a statistic.
//
// The points themselves are owned by the page, not by this panel, so that the
// PPTX export in the chart panel ships whatever the user is actually reading
// rather than regenerating its own copy.

import { useState } from "react";
import type { QuerySpec, ResultTable } from "@/lib/wonder/types";
import { safeJson } from "@/lib/safeJson";

export interface Analysis {
  headline: string;
  bullets: string[];
  caveats: string[];
  /** Statements dropped because a figure could not be verified. */
  dropped: number;
  /** True when verification left nothing usable and the computed bullets stand. */
  fellBack: boolean;
}

export default function InsightsPanel({
  table,
  spec,
  basePoints,
  analysis,
  onAnalysis,
}: {
  table: ResultTable;
  spec?: QuerySpec;
  /** Deterministic bullets computed from the table by the page. */
  basePoints: string[];
  /** AI analysis for THIS table, or null. Owned by the page. */
  analysis: Analysis | null;
  onAnalysis: (analysis: Analysis | null) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  // An error belongs to the specific table it came from. Tagging it lets a new
  // result invalidate it during render, instead of via an effect that fires a
  // second render pass.
  const [errorState, setErrorState] = useState<{ table: ResultTable; message: string } | null>(null);
  const error = errorState?.table === table ? errorState.message : null;

  const analyze = async () => {
    setLoading(true);
    setErrorState(null);
    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table, spec }),
      });
      const parsed = await safeJson<{ ok: boolean; error?: string } & Partial<Analysis>>(res);
      if (!parsed.ok) {
        setErrorState({ table, message: parsed.error });
        return;
      }
      if (!parsed.data.ok) {
        setErrorState({
          table,
          message: parsed.data.error ?? "Could not analyze this result.",
        });
        return;
      }
      onAnalysis({
        headline: parsed.data.headline ?? "",
        bullets: parsed.data.bullets ?? [],
        caveats: parsed.data.caveats ?? [],
        dropped: parsed.data.dropped ?? 0,
        fellBack: Boolean(parsed.data.fellBack),
      });
    } catch (e) {
      setErrorState({ table, message: e instanceof Error ? e.message : "Network error." });
    } finally {
      setLoading(false);
    }
  };

  const isAi = Boolean(analysis && !analysis.fellBack);
  const points = isAi && analysis ? analysis.bullets : basePoints;

  const copy = async () => {
    const lines = [
      ...(analysis?.headline ? [analysis.headline, ""] : []),
      ...points.map((p) => `• ${p}`),
      ...(analysis?.caveats?.length ? ["", ...analysis.caveats.map((c) => `Note: ${c}`)] : []),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — nothing useful to do */
    }
  };

  return (
    <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">
          Talking points
          {isAi && (
            <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
              AI analysis · figures verified
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copy}
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-white"
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
          {analysis && (
            <button
              type="button"
              onClick={() => onAnalysis(null)}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-white"
            >
              Revert
            </button>
          )}
          <button
            type="button"
            onClick={analyze}
            disabled={loading}
            title="Have AI read this table and write up what stands out. Every figure it returns is checked against the data first."
            className="rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Analyzing…" : analysis ? "✨ Re-analyze" : "✨ Analyze with AI"}
          </button>
        </div>
      </div>

      {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {isAi && analysis?.headline && (
        <p className="mb-3 border-l-2 border-violet-300 pl-3 text-sm font-medium text-slate-800">
          {analysis.headline}
        </p>
      )}

      <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">
        {points.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>

      {isAi && analysis && analysis.caveats.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-slate-200 pt-2 text-xs text-slate-600">
          {analysis.caveats.map((c, i) => (
            <li key={i}>⚠ {c}</li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-slate-400">
        {isAi
          ? `Written by AI from figures computed directly from this table; every number was checked against the data before display${
              analysis && analysis.dropped > 0
                ? `, and ${analysis.dropped} statement${analysis.dropped === 1 ? "" : "s"} that cited an unverifiable figure ${analysis.dropped === 1 ? "was" : "were"} removed`
                : ""
            }. Verify against the table before quoting.`
          : analysis?.fellBack
            ? "The AI analysis could not be verified against the data, so the computed talking points are shown instead."
            : "Computed directly from the data. Verify against the table before quoting."}
      </p>
    </div>
  );
}
