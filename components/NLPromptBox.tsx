"use client";

// Natural-language query box. Translates plain English into a QuerySpec via
// /api/nl (Gemini, free tier) and hands the result to the parent, which runs
// it through the normal /api/wonder pipeline — same path the manual query
// builder uses, so results are rendered identically.

import { useEffect, useState } from "react";
import type { QuerySpec } from "@/lib/wonder/types";
import { safeJson } from "@/lib/safeJson";

export interface NLResult {
  spec: QuerySpec;
  chartType?: string;
  summary: string;
  warnings: string[];
}

export default function NLPromptBox({
  onResult,
}: {
  onResult: (result: NLResult) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/nl")
      .then((r) => r.json())
      .then((d) => setEnabled(Boolean(d.enabled)))
      .catch(() => setEnabled(false));
  }, []);

  const submit = async () => {
    if (!text.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/nl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const parsed = await safeJson<{ ok: boolean; error?: string; spec: QuerySpec; chartType?: string; summary: string; warnings?: string[] }>(res);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      const data = parsed.data;
      if (!data.ok) {
        setError(data.error ?? "Could not interpret that request.");
        return;
      }
      onResult({
        spec: data.spec,
        chartType: data.chartType,
        summary: data.summary,
        warnings: data.warnings ?? [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-700">
          Ask in plain English
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            enabled
              ? "bg-emerald-100 text-emerald-700"
              : "bg-slate-100 text-slate-500"
          }`}
        >
          {enabled ? "AI enabled" : "AI not configured"}
        </span>
      </div>
      <div className="flex gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          disabled={!enabled || loading}
          rows={2}
          placeholder='e.g. "Table of suicides among 15–24 year old non-Hispanic white men from 2019–2024 by method, and a trend chart per method"'
          className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!enabled || loading || !text.trim()}
          className="shrink-0 self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {loading ? "Thinking…" : "Ask"}
        </button>
      </div>
      {error && (
        <p className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}
      {!enabled && (
        <p className="mt-2 text-xs text-slate-500">
          To enable natural-language queries, set{" "}
          <code className="rounded bg-slate-100 px-1">GEMINI_API_KEY</code> in{" "}
          <code className="rounded bg-slate-100 px-1">.env.local</code> and restart
          (free key at{" "}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            aistudio.google.com/apikey
          </a>
          ). Until then, use the query builder below — it does everything the AI
          box will translate into.
        </p>
      )}
    </div>
  );
}
