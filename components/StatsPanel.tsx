"use client";

// Statistics on the aggregated ResultTable:
//  - Regression: numeric-encoded dimension (year/month/age) vs a measure, r² + p
//  - ANOVA: compare a measure across categories of a dimension (one-way F test)
//  - Chi-square: association between two categorical dimensions (death-count table)
//  - Descriptives: mean/median/SD/min/max/sum + time trend (% change, CAGR)
// All methods operate on aggregated counts, not individual decedents.

import { useMemo, useState } from "react";
import type { ResultTable } from "@/lib/wonder/types";
import {
  cellLabel,
  cellNumber,
  dataRows,
  dimensionCols,
  measureCols,
  numericEncode,
} from "@/lib/tableUtils";
import { computeRegression } from "@/lib/stats/regression";
import { chiSquareFromCounts, pearson, spearman } from "@/lib/stats/correlation";
import { describe, oneWayAnova, trend } from "@/lib/stats/summary";

type Mode = "regression" | "anova" | "chisquare" | "descriptive";

const NUMERIC_KEYS = ["year", "month", "ageTen", "ageFive", "ageSingle"];

function fmtP(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return "n/a";
  return p < 0.001 ? "<0.001" : p.toFixed(3);
}
function fmtNum(x: number, d = 2): string {
  if (!Number.isFinite(x)) return "n/a";
  return x.toLocaleString(undefined, { maximumFractionDigits: d });
}

export default function StatsPanel({ table }: { table: ResultTable }) {
  const dims = dimensionCols(table);
  const measures = measureCols(table);
  const rows = useMemo(() => dataRows(table), [table]);
  const numericDims = dims.filter((d) => NUMERIC_KEYS.includes(d.column.variableKey ?? ""));

  const [mode, setMode] = useState<Mode>(numericDims.length > 0 ? "regression" : "descriptive");
  const [xIdx, setXIdx] = useState(numericDims[0]?.index ?? dims[0]?.index ?? 0);
  const [yIdx, setYIdx] = useState(measures[0]?.index ?? 0);
  const [rowIdx, setRowIdx] = useState(dims[0]?.index ?? 0);
  const [colIdx, setColIdx] = useState(dims[1]?.index ?? dims[0]?.index ?? 0);
  const [groupIdx, setGroupIdx] = useState(dims[0]?.index ?? 0);

  const regression = useMemo(() => {
    if (mode !== "regression") return null;
    const pairs: [number, number][] = [];
    for (const row of rows) {
      const nx = numericEncode(table.columns[xIdx]?.variableKey, cellLabel(row[xIdx]));
      const y = cellNumber(row[yIdx]);
      if (nx !== null && y !== null) pairs.push([nx, y]);
    }
    return { reg: computeRegression(pairs), pearson: pearson(pairs), spearman: spearman(pairs), n: pairs.length };
  }, [mode, rows, table.columns, xIdx, yIdx]);

  const chi = useMemo(() => {
    if (mode !== "chisquare") return null;
    const deathsCol = measures.find((m) => m.column.measureKey === "deaths") ?? measures[0];
    const entries = rows
      .map((row) => ({ row: cellLabel(row[rowIdx]), col: cellLabel(row[colIdx]), count: cellNumber(row[deathsCol.index]) ?? 0 }))
      .filter((e) => e.count > 0);
    return chiSquareFromCounts(entries);
  }, [mode, rows, rowIdx, colIdx, measures]);

  const anova = useMemo(() => {
    if (mode !== "anova") return null;
    const groups = new Map<string, number[]>();
    for (const row of rows) {
      const key = cellLabel(row[groupIdx]);
      const y = cellNumber(row[yIdx]);
      if (y === null) continue;
      let arr = groups.get(key);
      if (!arr) { arr = []; groups.set(key, arr); }
      arr.push(y);
    }
    return { result: oneWayAnova([...groups.values()]), k: groups.size };
  }, [mode, rows, groupIdx, yIdx]);

  const desc = useMemo(() => {
    if (mode !== "descriptive") return null;
    const values = rows.map((r) => cellNumber(r[yIdx])).filter((v): v is number => v !== null);
    const d = describe(values);
    // trend if a numeric time dimension exists: sum measure by that dim label
    const timeDim = numericDims.find((nd) => ["year", "month"].includes(nd.column.variableKey ?? ""));
    let tr = null;
    if (timeDim) {
      const byLabel = new Map<string, number>();
      for (const row of rows) {
        const label = cellLabel(row[timeDim.index]);
        const y = cellNumber(row[yIdx]) ?? 0;
        byLabel.set(label, (byLabel.get(label) ?? 0) + y);
      }
      const pts = [...byLabel.entries()]
        .map(([label, value]) => ({ label, value, ord: numericEncode(timeDim.column.variableKey, label) ?? 0 }))
        .sort((a, b) => a.ord - b.ord);
      tr = trend(pts);
    }
    return { d, tr, measureLabel: table.columns[yIdx]?.label ?? "" };
  }, [mode, rows, yIdx, numericDims, table.columns]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <ModeButton active={mode === "regression"} onClick={() => setMode("regression")}>Regression / correlation</ModeButton>
        <ModeButton active={mode === "anova"} onClick={() => setMode("anova")}>ANOVA</ModeButton>
        <ModeButton active={mode === "chisquare"} onClick={() => setMode("chisquare")}>Chi-square</ModeButton>
        <ModeButton active={mode === "descriptive"} onClick={() => setMode("descriptive")}>Descriptives</ModeButton>
      </div>

      {mode === "regression" && (
        <div className="space-y-3">
          <TwoSelects
            aLabel="X (numeric: year / month / age)" aValue={xIdx} aOptions={dims} onA={setXIdx}
            bLabel="Y (measure)" bValue={yIdx} bOptions={measures} onB={setYIdx}
          />
          {!regression?.reg || regression.n < 2 ? (
            <Warn>Pick a numeric X (year, month, or age group) — categorical dimensions like sex or race can’t be regressed.</Warn>
          ) : (
            <Card>
              <Stat label="Slope" value={fmtNum(regression.reg.slope, 4)} />
              <Stat label="Intercept" value={fmtNum(regression.reg.intercept, 3)} />
              <Stat label="r²" value={regression.reg.r2.toFixed(4)} />
              <Stat label="p-value (slope)" value={fmtP(regression.reg.pValue)} />
              <Stat label="Pearson r" value={regression.pearson?.toFixed(4) ?? "n/a"} />
              <Stat label="Spearman ρ" value={regression.spearman?.toFixed(4) ?? "n/a"} />
              <Stat label="n (points)" value={String(regression.n)} />
              <Note>
                {regression.reg.pValue !== null && regression.reg.pValue < 0.05
                  ? "The linear trend is statistically significant at α = 0.05."
                  : "The linear trend is not statistically significant at α = 0.05."}{" "}
                Computed on aggregated cell values, not individual decedents.
              </Note>
            </Card>
          )}
        </div>
      )}

      {mode === "anova" && (
        <div className="space-y-3">
          <TwoSelects
            aLabel="Compare across (groups)" aValue={groupIdx} aOptions={dims} onA={setGroupIdx}
            bLabel="Measure" bValue={yIdx} bOptions={measures} onB={setYIdx}
          />
          {!anova?.result ? (
            <Warn>Need at least two groups with values. Group your query by the dimension you want to compare.</Warn>
          ) : (
            <Card>
              <Stat label="Groups (k)" value={String(anova.result.groups)} />
              <Stat label="F" value={fmtNum(anova.result.f, 3)} />
              <Stat label="df (between, within)" value={`${anova.result.dfBetween}, ${anova.result.dfWithin}`} />
              <Stat label="p-value" value={fmtP(anova.result.pValue)} />
              <Stat label="η² (effect size)" value={anova.result.etaSquared.toFixed(3)} />
              <Note>
                {anova.result.pValue < 0.05
                  ? `Mean ${table.columns[yIdx]?.label} differs significantly across ${table.columns[groupIdx]?.label} (α = 0.05).`
                  : `No significant difference in mean ${table.columns[yIdx]?.label} across ${table.columns[groupIdx]?.label}.`}{" "}
                Each aggregated cell is treated as one observation.
              </Note>
            </Card>
          )}
        </div>
      )}

      {mode === "chisquare" && (
        <div className="space-y-3">
          <TwoSelects
            aLabel="Rows" aValue={rowIdx} aOptions={dims} onA={setRowIdx}
            bLabel="Columns" bValue={colIdx} bOptions={dims} onB={setColIdx}
          />
          {rowIdx === colIdx ? (
            <Warn>Choose two different dimensions to test their association.</Warn>
          ) : !chi ? (
            <Warn>Need at least a 2×2 table with non-zero counts.</Warn>
          ) : (
            <Card>
              <Stat label="χ²" value={fmtNum(chi.chi2, 2)} />
              <Stat label="Degrees of freedom" value={String(chi.df)} />
              <Stat label="p-value" value={fmtP(chi.pValue)} />
              <Stat label="Cramér’s V" value={chi.cramersV.toFixed(3)} />
              <Stat label="N (deaths)" value={chi.n.toLocaleString()} />
              <Note>
                {chi.pValue < 0.05
                  ? `Significant association between ${table.columns[rowIdx].label} and ${table.columns[colIdx].label} (α = 0.05).`
                  : `No significant association at α = 0.05.`}{" "}
                With very large N even tiny associations become significant — see Cramér’s V for effect size.
              </Note>
            </Card>
          )}
        </div>
      )}

      {mode === "descriptive" && desc && (
        <div className="space-y-3">
          <label className="block max-w-xs">
            <span className="mb-1 block text-xs font-medium text-slate-600">Measure</span>
            <select value={yIdx} onChange={(e) => setYIdx(Number(e.target.value))} className="ctrl">
              {measures.map((m) => <option key={m.index} value={m.index}>{m.column.label}</option>)}
            </select>
          </label>
          {!desc.d ? (
            <Warn>No numeric values to summarize.</Warn>
          ) : (
            <Card>
              <Stat label="n (cells)" value={desc.d.n.toLocaleString()} />
              <Stat label="Sum" value={fmtNum(desc.d.sum, 1)} />
              <Stat label="Mean" value={fmtNum(desc.d.mean, 2)} />
              <Stat label="Median" value={fmtNum(desc.d.median, 2)} />
              <Stat label="Std. dev." value={fmtNum(desc.d.sd, 2)} />
              <Stat label="Min / Max" value={`${fmtNum(desc.d.min, 2)} / ${fmtNum(desc.d.max, 2)}`} />
              {desc.tr && (
                <>
                  <Stat label={`Change ${desc.tr.firstLabel}→${desc.tr.lastLabel}`} value={`${desc.tr.totalChangePct >= 0 ? "+" : ""}${fmtNum(desc.tr.totalChangePct, 1)}%`} />
                  <Stat label="Avg annual change (CAGR)" value={`${desc.tr.cagrPct >= 0 ? "+" : ""}${fmtNum(desc.tr.cagrPct, 1)}%`} />
                </>
              )}
              <Note>Summary of the {desc.measureLabel} across the query’s aggregated cells{desc.tr ? "; trend uses the total per period." : "."}</Note>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function TwoSelects({
  aLabel, aValue, aOptions, onA, bLabel, bValue, bOptions, onB,
}: {
  aLabel: string; aValue: number; aOptions: { index: number; column: { label: string } }[]; onA: (n: number) => void;
  bLabel: string; bValue: number; bOptions: { index: number; column: { label: string } }[]; onB: (n: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">{aLabel}</span>
        <select value={aValue} onChange={(e) => onA(Number(e.target.value))} className="ctrl">
          {aOptions.map((d) => <option key={d.index} value={d.index}>{d.column.label}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">{bLabel}</span>
        <select value={bValue} onChange={(e) => onB(Number(e.target.value))} className="ctrl">
          {bOptions.map((d) => <option key={d.index} value={d.index}>{d.column.label}</option>)}
        </select>
      </label>
    </div>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
      {children}
    </button>
  );
}
function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">{children}</div>;
}
function Warn({ children }: { children: React.ReactNode }) {
  return <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-700">{children}</p>;
}
function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-xs text-slate-500">{children}</p>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-1 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono font-medium text-slate-800">{value}</span>
    </div>
  );
}
