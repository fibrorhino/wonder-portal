"use client";

// Natural-language query box. This is the eventual headline feature; for now it
// is present but disabled. It probes /api/nl to see whether an ANTHROPIC_API_KEY
// has been configured and, if not, explains how to enable it. The QuerySpec
// seam is already wired so the interpreter can be dropped in later.

import { useEffect, useState } from "react";

export default function NLPromptBox() {
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState("");

  useEffect(() => {
    fetch("/api/nl")
      .then((r) => r.json())
      .then((d) => setEnabled(Boolean(d.enabled)))
      .catch(() => setEnabled(false));
  }, []);

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
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!enabled}
        rows={2}
        placeholder='e.g. "Table of suicides among 15–24 year old non-Hispanic white men from 2019–2024 by method, and a trend chart per method"'
        className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50"
      />
      {!enabled && (
        <p className="mt-2 text-xs text-slate-500">
          To enable natural-language queries, set an{" "}
          <code className="rounded bg-slate-100 px-1">ANTHROPIC_API_KEY</code> in{" "}
          <code className="rounded bg-slate-100 px-1">.env.local</code> and restart.
          Until then, use the query builder below — it can do everything the AI box
          will translate into.
        </p>
      )}
    </div>
  );
}
