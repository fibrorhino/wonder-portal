"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { QuerySpec, ResultTable, WonderResponse } from "@/lib/wonder/types";
import { talkingPoints } from "@/lib/insights";
import { safeJson } from "@/lib/safeJson";
import { filterChips } from "@/lib/describeSpec";
import { shareUrl, specFromLocation, updateLocation } from "@/lib/shareLink";
import { DEFAULT_DATABASE_ID, getDatabase } from "@/lib/wonder/db/registry";
import DatasetPicker from "@/components/DatasetPicker";
import Header from "@/components/Header";
import { DataUseLink } from "@/components/DataUseNotice";
import NLPromptBox, { type NLResult } from "@/components/NLPromptBox";
import QueryBuilder from "@/components/QueryBuilder";
import ResultsTable from "@/components/ResultsTable";
import ChartPanel from "@/components/ChartPanel";
import StatsPanel from "@/components/StatsPanel";
import InsightsPanel, { type Analysis } from "@/components/InsightsPanel";
import ExampleQueries from "@/components/ExampleQueries";
import RecentQueries from "@/components/RecentQueries";
import ComparePanel from "@/components/ComparePanel";
import { clearHistory, loadHistory, recordQuery, type HistoryEntry } from "@/lib/queryHistory";

const INITIAL_SPEC: QuerySpec = {
  database: DEFAULT_DATABASE_ID,
  groupBy: ["year"],
  // Population is requested by default because it is the denominator the
  // insights engine needs to build correct marginal rates (lib/analysis/facts.ts);
  // WONDER returns it either way, so this costs nothing but a column.
  //
  // Age-adjusted rate is on by default too: a crude rate comparison across
  // groups with different age structures (race, sex, education) is misleading,
  // and it was the caveat the analysis raised on almost every run. WONDER
  // omits it when the query groups by age, where it does not apply.
  measures: ["deaths", "population", "crudeRate", "ageAdjustedRate"],
  filters: {},
  options: { showTotals: true, showZeros: true, showSuppressed: true, ratePer: 100000 },
};

type Tab = "table" | "chart" | "stats" | "compare";

export default function Home() {
  const [spec, setSpec] = useState<QuerySpec>(INITIAL_SPEC);
  const [result, setResult] = useState<WonderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("table");
  const [nlSummary, setNlSummary] = useState<string | null>(null);
  const [nlWarnings, setNlWarnings] = useState<string[]>([]);
  const [suggestedChartType, setSuggestedChartType] = useState<string | undefined>(undefined);
  const [chartKey, setChartKey] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [copiedLink, setCopiedLink] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // The "A" side of a comparison: a result the user parked to diff against.
  const [pinned, setPinned] = useState<{ table: ResultTable; spec: QuerySpec } | null>(null);
  // On a phone the builder and the results cannot both be on screen, so the
  // builder folds away once there is a result to look at. Irrelevant at lg and
  // up, where the two sit side by side and this state is ignored.
  const [builderOpen, setBuilderOpen] = useState(true);

  // CDC pauses at least 15 s between requests and a wide query can take a
  // while on top of that, so a bare "Querying…" reads as a hang. The elapsed
  // seconds make it obvious the request is still alive.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  // The AI analysis lives here, not in InsightsPanel, so that the PPTX export
  // in ChartPanel ships the same bullets the user is actually reading. Tagged
  // with the table it was produced from, so a new result invalidates it during
  // render rather than via an effect.
  const [ai, setAi] = useState<{ table: ResultTable; analysis: Analysis } | null>(null);

  const run = async (specToRun: QuerySpec = spec, landOnTab: Tab = "table") => {
    setLoading(true);
    setError(null);
    setElapsed(0);
    const startedAt = Date.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(
      () => setElapsed(Math.round((Date.now() - startedAt) / 1000)),
      1000,
    );
    // The spec lives in the URL so the result can be linked to and reloaded.
    updateLocation(specToRun);
    try {
      const res = await fetch("/api/wonder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(specToRun),
      });
      const parsed = await safeJson<WonderResponse>(res);
      if (!parsed.ok) {
        setError(parsed.error);
        setResult(null);
        return;
      }
      const data = parsed.data;
      if (!data.ok) {
        setError(data.error ?? "Query failed.");
        setResult(null);
      } else {
        setResult(data);
        setTab(landOnTab);
        setHistory(recordQuery(specToRun));
        // Narrow screens only: get the result on screen instead of leaving the
        // user to scroll past the whole builder.
        if (window.matchMedia("(max-width: 1023px)").matches) setBuilderOpen(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      setResult(null);
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      setLoading(false);
    }
  };

  /**
   * Switch dataset. The query is rebuilt rather than carried over: the two
   * datasets do not share a variable list, so a filter on weekday or education
   * would silently become an invalid query, and a measures list containing
   * age-adjusted rate is rejected by the provisional file. Grouping by year is
   * the one thing both always support, so that is where the new spec starts.
   */
  const changeDataset = (id: string) => {
    const db = getDatabase(id);
    setSpec({
      database: db.id,
      groupBy: ["year"],
      measures: INITIAL_SPEC.measures.filter((m) => db.measures.includes(m)),
      filters: {},
      options: { ...INITIAL_SPEC.options },
    });
    // Results, comparison and AI analysis all belong to the previous dataset.
    setResult(null);
    setError(null);
    setPinned(null);
    setAi(null);
    setNlSummary(null);
    setNlWarnings([]);
    setTab("table");
  };

  /** Load a spec into the builder and run it. */
  const applyAndRun = (next: QuerySpec, landOnTab: Tab = "table") => {
    setSpec(next);
    setNlSummary(null);
    setNlWarnings([]);
    void run(next, landOnTab);
  };

  useEffect(() => {
    // localStorage is client-only, so the list starts empty and fills in on
    // mount rather than being read during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory(loadHistory());
  }, []);

  // A shared link carries a spec in the URL fragment. Reading it is a
  // subscription to an external system (the address bar), which is what an
  // effect is for; it cannot be lazy state because the server render has no
  // window and would then disagree with the client.
  const restored = useRef(false);
  useEffect(() => {
    const applyFromHash = () => {
      const fromLink = specFromLocation();
      if (fromLink && fromLink.groupBy.length > 0) applyAndRun(fromLink);
    };
    // Once on mount: lazy initial state cannot read the fragment, because the
    // server render has no window and the two would then disagree.
    if (!restored.current) {
      restored.current = true;
      applyFromHash();
    }
    // Pasting a link into a tab that already has the app open changes only the
    // fragment, so there is no reload and the mount path never runs again. The
    // app's own updateLocation uses replaceState, which does not fire this.
    window.addEventListener("hashchange", applyFromHash);
    return () => window.removeEventListener("hashchange", applyFromHash);
    // Mount-only: later spec changes are driven by the UI, not the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyLink = async () => {
    if (!result?.spec) return;
    try {
      await navigator.clipboard.writeText(shareUrl(result.spec));
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      /* clipboard blocked — nothing useful to do */
    }
  };

  const handleNLResult = (nl: NLResult) => {
    setSpec(nl.spec);
    setNlSummary(nl.summary);
    setNlWarnings(nl.warnings);
    setSuggestedChartType(nl.chartType);
    setChartKey((k) => k + 1);
    void run(nl.spec, nl.chartType ? "chart" : "table");
  };

  const table = result?.table;
  const isPinnedResult = Boolean(pinned && table && pinned.table === table);

  // The chart and stats panels address columns by numeric index. When a new
  // query returns a different column layout those indices point at the wrong
  // column (silently charting/analysing the wrong field), so the panels are
  // keyed on the column signature and remount when the shape changes. A query
  // with the same shape but different filters keeps the user's chart settings.
  const shapeKey = useMemo(
    () => (table ? table.columns.map((c) => c.key).join("|") : ""),
    [table],
  );

  // Deterministic bullets, computed once and shared by the insights panel and
  // the PPTX export. The spec matters: it supplies the rate denominator and the
  // filter description the fact sheet is built from.
  const basePoints = useMemo(
    () => (table ? talkingPoints(table, result?.spec) : []),
    [table, result?.spec],
  );
  const analysis = table && ai?.table === table ? ai.analysis : null;
  // An analysis that fell back to the computed bullets is not an AI result, so
  // the export ships the same thing the panel is showing.
  const points = analysis && !analysis.fellBack ? analysis.bullets : basePoints;

  return (
    <div className="flex min-h-full flex-col bg-[#e7f0fa]">
      <Header />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5">
        <div className="mb-5">
          <DatasetPicker
            databaseId={spec.database}
            onChange={changeDataset}
            disabled={loading}
          />
        </div>

        <div className="mb-5">
          <NLPromptBox databaseId={spec.database} onResult={handleNLResult} />
        </div>

        <div className="mb-5 space-y-4">
          <ExampleQueries
            databaseId={spec.database}
            onPick={(next) => applyAndRun(next)}
            disabled={loading}
          />
          <RecentQueries
            entries={history}
            onPick={(next) => applyAndRun(next)}
            onClear={() => setHistory(clearHistory())}
            disabled={loading}
          />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[380px_1fr]">
          {/* Left: query builder */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <button
              type="button"
              onClick={() => setBuilderOpen((o) => !o)}
              aria-expanded={builderOpen}
              className="mb-3 flex w-full items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 lg:hidden"
            >
              Query builder
              <span aria-hidden="true">{builderOpen ? "▲" : "▼"}</span>
            </button>
            <div className={builderOpen ? "" : "hidden lg:block"}>
              <QueryBuilder
                spec={spec}
                onChange={(s) => {
                  setSpec(s);
                  setNlSummary(null);
                }}
                onRun={() => run()}
                loading={loading}
              />
            </div>
          </div>

          {/* Right: results */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            {error && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {!error && nlSummary && table && (
              <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                <p>🤖 {nlSummary}</p>
                {nlWarnings.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-xs text-blue-700">
                    {nlWarnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {loading && (
              <div className="flex h-64 items-center justify-center text-center text-slate-500">
                <div>
                  <p className="text-sm font-medium">Querying CDC WONDER…</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {elapsed}s elapsed
                    {elapsed >= 12
                      ? " — CDC requires at least 15 seconds between queries, so the first one after another can wait."
                      : ""}
                  </p>
                </div>
              </div>
            )}

            {!table && !error && !loading && (
              <div className="flex h-64 items-center justify-center text-center text-slate-400">
                <div>
                  <p className="text-sm">
                    Pick an example above, or build a query on the left and click{" "}
                    <strong>Run query</strong>.
                  </p>
                  <p className="mt-1 text-xs">
                    Results open as a table; the Chart and Stats tabs work on the
                    same data.
                  </p>
                </div>
              </div>
            )}

            {table && (
              <>
                <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
                  {((pinned ? ["table", "chart", "stats", "compare"] : ["table", "chart", "stats"]) as Tab[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className={`shrink-0 px-4 py-2 text-sm font-medium capitalize ${
                        tab === t
                          ? "border-b-2 border-blue-600 text-blue-600"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {t === "compare" ? "Compare ⚖" : t}
                    </button>
                  ))}
                </div>

                {/* Active filters that produced these results */}
                {result?.spec && (
                  <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={copyLink}
                      title="Copy a link that reopens this exact query"
                      className="rounded-full border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      {copiedLink ? "Link copied ✓" : "🔗 Copy link"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!table || !result?.spec) return;
                        setPinned({ table, spec: result.spec });
                      }}
                      title="Park this result, then run another query to see the difference"
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                        isPinnedResult
                          ? "border-violet-300 bg-violet-50 text-violet-700"
                          : "border-slate-300 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {isPinnedResult ? "📌 Pinned as A" : "📌 Pin to compare"}
                    </button>
                    <span className="text-xs font-medium text-slate-500">Filters:</span>
                    {filterChips(result.spec).length === 0 ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        None (all deaths, all years)
                      </span>
                    ) : (
                      filterChips(result.spec).map((c) => (
                        <span
                          key={c.key}
                          className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-800"
                        >
                          <span className="font-medium">{c.label}:</span> {c.value}
                        </span>
                      ))
                    )}
                  </div>
                )}

                {tab === "table" && <ResultsTable table={table} />}
                {tab === "chart" && (
                  <ChartPanel
                    key={`${chartKey}:${shapeKey}`}
                    table={table}
                    initialChartType={suggestedChartType}
                    spec={result?.spec}
                    talkingPoints={points}
                  />
                )}
                {tab === "stats" && <StatsPanel key={shapeKey} table={table} />}
                {tab === "compare" && pinned && (
                  <ComparePanel
                    pinned={pinned.table}
                    pinnedSpec={pinned.spec}
                    current={table}
                    currentSpec={result?.spec}
                    onUnpin={() => {
                      setPinned(null);
                      setTab("table");
                    }}
                  />
                )}

                <InsightsPanel
                  table={table}
                  spec={result?.spec}
                  basePoints={basePoints}
                  analysis={analysis}
                  onAnalysis={(next) => setAi(next ? { table, analysis: next } : null)}
                />
              </>
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl space-y-1.5 px-4 py-4 text-xs text-slate-500">
          <p>
            <span className="font-medium text-slate-600">Data source:</span>{" "}
            Centers for Disease Control and Prevention, National Center for
            Health Statistics. {getDatabase(spec.database).label}, CDC WONDER
            online database.
            National data only (sub-national queries are unavailable via the
            API). Counts of 1–9 are suppressed and rates based on &lt;20 deaths
            are flagged unreliable, per CDC policy. Use of these data is subject
            to the <DataUseLink />.
          </p>
          <p>
            The Mortality Data Portal is an independent tool built at the Johns
            Hopkins Center for Suicide Prevention. It is not affiliated with,
            operated by, or endorsed by the CDC, and “CDC WONDER” is named here
            only to credit the source of the data.
          </p>
          {/* Footnote for the asterisks on the "Run query" and "Ask" buttons.
              Running a query accepts CDC's data use restrictions on the
              visitor's behalf, so the terms they are bound by are stated here
              rather than left implicit. */}
          <p className="mt-2">
            * Running a query submits it to CDC WONDER under CDC&apos;s data use
            restrictions, which are accepted on your behalf. These data are
            provided for statistical reporting and analysis only. You must make
            no attempt to learn the identity of any person or establishment
            included in the data, and must not link them with other data for
            that purpose; any identity discovered inadvertently must be reported
            to the Director, NCHS. Full terms:{" "}
            <a
              href="https://wonder.cdc.gov/datause.html"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-slate-700"
            >
              CDC WONDER Data Use Restrictions
            </a>
            .
          </p>
        </div>
      </footer>
    </div>
  );
}
