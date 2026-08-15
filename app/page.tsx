"use client";

import { useMemo, useState } from "react";
import type { QuerySpec, ResultTable, WonderResponse } from "@/lib/wonder/types";
import { talkingPoints } from "@/lib/insights";
import { safeJson } from "@/lib/safeJson";
import { filterChips } from "@/lib/describeSpec";
import { DATABASE_LABEL } from "@/lib/wonder/databases";
import Header from "@/components/Header";
import NLPromptBox, { type NLResult } from "@/components/NLPromptBox";
import QueryBuilder from "@/components/QueryBuilder";
import ResultsTable from "@/components/ResultsTable";
import ChartPanel from "@/components/ChartPanel";
import StatsPanel from "@/components/StatsPanel";
import InsightsPanel from "@/components/InsightsPanel";

const INITIAL_SPEC: QuerySpec = {
  database: "D158",
  groupBy: ["year"],
  measures: ["deaths", "crudeRate"],
  filters: {},
  options: { showTotals: true, showZeros: true, showSuppressed: true, ratePer: 100000 },
};

type Tab = "table" | "chart" | "stats";

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
  // The AI-polished talking points live here, not in InsightsPanel, so that the
  // PPTX export in ChartPanel ships the same bullets the user is reading.
  // Tagged with the table they were produced from, so a new result invalidates
  // them during render rather than via an effect.
  const [ai, setAi] = useState<{ table: ResultTable; points: string[] } | null>(null);

  const run = async (specToRun: QuerySpec = spec, landOnTab: Tab = "table") => {
    setLoading(true);
    setError(null);
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
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      setResult(null);
    } finally {
      setLoading(false);
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
  // the PPTX export.
  const basePoints = useMemo(() => (table ? talkingPoints(table) : []), [table]);
  const aiPoints = table && ai?.table === table ? ai.points : null;
  const points = aiPoints ?? basePoints;

  return (
    <div className="flex min-h-full flex-col bg-[#e7f0fa]">
      <Header />
      <div className="border-b border-slate-100 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-1.5">
          <p className="text-xs text-slate-400">{DATABASE_LABEL}</p>
        </div>
      </div>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5">
        <div className="mb-5">
          <NLPromptBox onResult={handleNLResult} />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[380px_1fr]">
          {/* Left: query builder */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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

            {!table && !error && (
              <div className="flex h-64 items-center justify-center text-center text-slate-400">
                <div>
                  <p className="text-sm">
                    Build a query on the left and click <strong>Run query</strong>.
                  </p>
                  <p className="mt-1 text-xs">
                    Try the preset “Suicide (intent)”, group by Year and Injury
                    Mechanism, then open the Chart tab.
                  </p>
                </div>
              </div>
            )}

            {table && (
              <>
                <div className="mb-4 flex gap-1 border-b border-slate-200">
                  {(["table", "chart", "stats"] as Tab[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className={`px-4 py-2 text-sm font-medium capitalize ${
                        tab === t
                          ? "border-b-2 border-blue-600 text-blue-600"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {/* Active filters that produced these results */}
                {result?.spec && (
                  <div className="mb-3 flex flex-wrap items-center gap-1.5">
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

                <InsightsPanel
                  table={table}
                  spec={result?.spec}
                  basePoints={basePoints}
                  aiPoints={aiPoints}
                  onAiPoints={(next) => setAi(next ? { table, points: next } : null)}
                />
              </>
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 text-xs text-slate-500">
          <p>
            Data source: Centers for Disease Control and Prevention, National
            Center for Health Statistics. {DATABASE_LABEL}, CDC WONDER online
            database. National data only (sub-national queries are unavailable via
            the API). Counts of 1–9 are suppressed and rates based on &lt;20 deaths
            are flagged unreliable, per CDC policy. This tool is not affiliated with
            the CDC.
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
