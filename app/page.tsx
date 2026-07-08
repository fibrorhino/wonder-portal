"use client";

import { useState } from "react";
import type { QuerySpec, WonderResponse } from "@/lib/wonder/types";
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

  const run = async (specToRun: QuerySpec = spec) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/wonder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(specToRun),
      });
      const data: WonderResponse = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Query failed.");
        setResult(null);
      } else {
        setResult(data);
        setTab("table");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
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
    void run(nl.spec);
    if (nl.chartType) setTab("chart");
  };

  const table = result?.table;

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

                {tab === "table" && <ResultsTable table={table} />}
                {tab === "chart" && (
                  <ChartPanel key={chartKey} table={table} initialChartType={suggestedChartType} />
                )}
                {tab === "stats" && <StatsPanel table={table} />}

                <InsightsPanel table={table} />
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
        </div>
      </footer>
    </div>
  );
}
