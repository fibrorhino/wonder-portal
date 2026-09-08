"use client";

// Customizable Plotly figure from a ResultTable. Chart types: line, bar,
// stacked bar, horizontal bar, area, scatter, pie, donut. Options: color
// palette, stacking, log Y axis, data labels, markers, smoothing, legend
// position, sort, and a scatter trendline with r² drawn on the figure.

import { useMemo, useRef, useState } from "react";
import Plot, { type PlotHandle } from "./Plot";
import type { MeasureKey, QuerySpec, ResultTable } from "@/lib/wonder/types";
import { figureCaption } from "@/lib/describeSpec";
import {
  cellLabel,
  cellNumber,
  dataRows,
  dimensionCols,
  measureCols,
  numericEncode,
} from "@/lib/tableUtils";
import { computeRegression } from "@/lib/stats/regression";
import { exportPptx } from "@/lib/export/pptx";

type ChartType =
  | "line"
  | "bar"
  | "stackedBar"
  | "horizontalBar"
  | "area"
  | "scatter"
  | "bubble"
  | "pie"
  | "donut"
  | "heatmap"
  | "treemap"
  | "sunburst"
  | "scatter3d";

const NO_CARTESIAN: ChartType[] = ["pie", "donut", "treemap", "sunburst", "scatter3d"];

const PALETTES: Record<string, string[]> = {
  Default: ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#0d9488", "#9333ea", "#ea580c", "#475569"],
  Hopkins: ["#002d72", "#68ace5", "#a15a95", "#ff9e1b", "#31859b", "#cf4520", "#286dc0", "#76a934", "#8a2be2", "#5b6770"],
  Viridis: ["#440154", "#472d7b", "#3b528b", "#2c728e", "#21908c", "#27ad81", "#5dc963", "#aadc32", "#fde725", "#90d743"],
  Warm: ["#7f1d1d", "#b45309", "#dc2626", "#db2777", "#ea580c", "#ca8a04", "#9f1239", "#e11d48", "#f59e0b", "#f43f5e"],
  Grayscale: ["#111827", "#374151", "#6b7280", "#9ca3af", "#4b5563", "#1f2937", "#d1d5db", "#030712", "#94a3b8", "#64748b"],
};

const isBarLike = (t: ChartType) => ["bar", "stackedBar", "horizontalBar"].includes(t);

const OTHER_LABEL = "Other";
/** Options for how many categories to draw before the tail is folded away. */
const TOP_N_CHOICES = [5, 8, 10, 15, 20] as const;
/** Above this many categories the tail is folded by default. */
const AUTO_FOLD_ABOVE = 12;
const DEFAULT_TOP_N = 10;

/**
 * Counts can be pooled into an "Other" bucket by adding them up. Rates cannot:
 * a rate is deaths per population, and the mean of several rates is not the
 * rate of the combined group. For a rate the tail is therefore hidden rather
 * than merged, and the caption says so.
 */
const isAdditiveMeasure = (key?: MeasureKey) => key === "deaths" || key === "population";

const VALID_CHART_TYPES: ChartType[] = [
  "line", "bar", "stackedBar", "horizontalBar", "area", "scatter", "bubble",
  "pie", "donut", "heatmap", "treemap", "sunburst", "scatter3d",
];

export default function ChartPanel({
  table,
  initialChartType,
  spec,
  talkingPoints,
}: {
  table: ResultTable;
  initialChartType?: string;
  spec?: QuerySpec;
  /** The bullets currently shown below the tabs — AI-polished if the user
   *  polished them — so the exported deck matches what they are reading. */
  talkingPoints: string[];
}) {
  const dims = dimensionCols(table);
  const measures = measureCols(table);
  const plotRef = useRef<PlotHandle>(null);
  const rows = useMemo(() => dataRows(table), [table]);

  const hasTime = dims.some((d) => ["year", "month"].includes(d.column.variableKey ?? ""));
  const suggested = VALID_CHART_TYPES.includes(initialChartType as ChartType)
    ? (initialChartType as ChartType)
    : undefined;
  const [chartType, setChartType] = useState<ChartType>(suggested ?? (hasTime ? "line" : "bar"));
  const [xIdx, setXIdx] = useState(dims[0]?.index ?? 0);
  const [seriesIdx, setSeriesIdx] = useState(dims[1]?.index ?? -1);
  const [measureIdx, setMeasureIdx] = useState(measures[0]?.index ?? 0);
  const [title, setTitle] = useState("");
  const [xTitle, setXTitle] = useState("");
  const [yTitle, setYTitle] = useState("");
  const [palette, setPalette] = useState("Default");
  const [trendline, setTrendline] = useState(false);
  const [logY, setLogY] = useState(false);
  const [dataLabels, setDataLabels] = useState(false);
  const [smooth, setSmooth] = useState(false);
  const [sortDesc, setSortDesc] = useState(false);
  const [legendPos, setLegendPos] = useState<"top" | "right" | "bottom">("bottom");
  const [showFilters, setShowFilters] = useState(true);
  // How many categories to draw before folding the tail, remembered PER
  // DIMENSION. Null means "decide from the data" — grouping by injury mechanism
  // yields ~70 categories and a legend taller than the figure, which is
  // unreadable by default; a query with six races needs no folding at all.
  //
  // Keyed by dimension because the choice does not transfer: picking "Top 5"
  // for 70 injury mechanisms and then switching to a pie of 7 years would
  // otherwise fold five years into "Other", which is nonsense. This is the same
  // trap the sort toggle fell into when it survived a change of chart type.
  const [topNByDim, setTopNByDim] = useState<Record<number, number | "all">>({});

  // Caption drawn onto the figure so exported images/slides remain
  // self-explanatory: grouping, filters, and the data-source citation.
  const captionLines = useMemo(() => (spec ? figureCaption(spec) : []), [spec]);
  // Single-line form, kept for the PPTX exporter's older `filterCaption` field.
  const filterCaption = captionLines.join(" — ");

  const xCol = table.columns[xIdx];
  const yCol = table.columns[measureIdx];
  const isPie = chartType === "pie" || chartType === "donut";
  const horizontal = chartType === "horizontalBar";

  // The dimension whose distinct values become slices (pie) or lines (series).
  const foldedDimIdx = isPie ? xIdx : seriesIdx;
  const categoryCount = useMemo(() => {
    if (foldedDimIdx < 0) return 0;
    return new Set(rows.map((r) => cellLabel(r[foldedDimIdx]))).size;
  }, [rows, foldedDimIdx]);

  const topN = topNByDim[foldedDimIdx] ?? null;
  const setTopN = (value: number | "all") =>
    setTopNByDim((prev) => ({ ...prev, [foldedDimIdx]: value }));

  const additive = isAdditiveMeasure(yCol?.measureKey);
  // null = not chosen by the user, so fold only when the chart would be unreadable.
  const effectiveTopN =
    topN === "all"
      ? null
      : topN === null
        ? categoryCount > AUTO_FOLD_ABOVE
          ? DEFAULT_TOP_N
          : null
        : topN;

  const { data, annotations, regressionNote, folded } = useMemo(() => {
    const colors = PALETTES[palette];
    // Set by whichever branch folds a tail, for the caption below the chart.
    let foldedCount = 0;

    // ---- Pie / donut: aggregate the measure by the X category ----
    if (isPie) {
      const byCat = new Map<string, number>();
      for (const row of rows) {
        const cat = cellLabel(row[xIdx]);
        const y = cellNumber(row[measureIdx]);
        if (y === null) continue;
        byCat.set(cat, (byCat.get(cat) ?? 0) + y);
      }
      let entries = [...byCat.entries()];
      if (effectiveTopN !== null && entries.length > effectiveTopN + 1) {
        // Ranking by value is what makes "the top N" meaningful, so the tail is
        // chosen by size regardless of the sort toggle.
        const ranked = [...entries].sort((a, b) => b[1] - a[1]);
        const kept = ranked.slice(0, effectiveTopN);
        const tail = ranked.slice(effectiveTopN);
        foldedCount = tail.length;
        entries = additive
          ? [...kept, [OTHER_LABEL, tail.reduce((sum, [, v]) => sum + v, 0)] as [string, number]]
          : kept;
      } else if (sortDesc) {
        entries.sort((a, b) => b[1] - a[1]);
      }
      return {
        folded: foldedCount,
        data: [
          {
            type: "pie",
            hole: chartType === "donut" ? 0.5 : 0,
            labels: entries.map((e) => e[0]),
            values: entries.map((e) => e[1]),
            marker: { colors: entries.map((_, i) => colors[i % colors.length]) },
            textinfo: dataLabels ? "label+percent" : "percent",
            hovertemplate: "%{label}<br>%{value:,} (%{percent})<extra></extra>",
          },
        ] as Record<string, unknown>[],
        annotations: [] as Record<string, unknown>[],
        regressionNote: null as string | null,
      };
    }

    const nil = {
      annotations: [] as Record<string, unknown>[],
      regressionNote: null as string | null,
      folded: 0,
    };

    // ---- Heatmap: X category × series category, colored by the measure ----
    if (chartType === "heatmap") {
      const xLabels: string[] = [];
      const yLabels: string[] = [];
      const xs = new Set<string>();
      const ys = new Set<string>();
      const z = new Map<string, number>();
      for (const row of rows) {
        const v = cellNumber(row[measureIdx]);
        if (v === null) continue;
        const xl = cellLabel(row[xIdx]);
        const yl = seriesIdx >= 0 ? cellLabel(row[seriesIdx]) : yCol?.label ?? "Value";
        if (!xs.has(xl)) { xs.add(xl); xLabels.push(xl); }
        if (!ys.has(yl)) { ys.add(yl); yLabels.push(yl); }
        z.set(yl + "||" + xl, (z.get(yl + "||" + xl) ?? 0) + v);
      }
      const matrix = yLabels.map((yl) => xLabels.map((xl) => z.get(yl + "||" + xl) ?? null));
      return {
        data: [{ type: "heatmap", x: xLabels, y: yLabels, z: matrix, colorscale: "Blues", hoverongaps: false, colorbar: { title: { text: yCol?.label } } }] as Record<string, unknown>[],
        ...nil,
      };
    }

    // ---- Treemap / sunburst: hierarchy of X (-> series) sized by the measure ----
    if (chartType === "treemap" || chartType === "sunburst") {
      const useSeries = seriesIdx >= 0;
      const l1 = new Map<string, number>();
      const l2 = new Map<string, number>();
      for (const row of rows) {
        const v = cellNumber(row[measureIdx]);
        if (v === null || v <= 0) continue;
        const x = cellLabel(row[xIdx]);
        l1.set(x, (l1.get(x) ?? 0) + v);
        if (useSeries) {
          const s = cellLabel(row[seriesIdx]);
          l2.set(x + "||" + s, (l2.get(x + "||" + s) ?? 0) + v);
        }
      }
      const ids: string[] = [];
      const labels: string[] = [];
      const parents: string[] = [];
      const values: number[] = [];
      for (const [x, v] of l1) { ids.push(x); labels.push(x); parents.push(""); values.push(v); }
      if (useSeries) for (const [k, v] of l2) { const [x, s] = k.split("||"); ids.push(k); labels.push(s); parents.push(x); values.push(v); }
      return {
        data: [{ type: chartType, ids, labels, parents, values, branchvalues: "total", textinfo: "label+value+percent parent", marker: { colorway: colors } }] as Record<string, unknown>[],
        ...nil,
      };
    }

    // ---- 3D scatter: X (numeric) × series × measure ----
    if (chartType === "scatter3d") {
      const seriesCol = table.columns[seriesIdx];
      const seriesVals = seriesIdx >= 0 ? [...new Set(rows.map((r) => cellLabel(r[seriesIdx])))] : [];
      const X: (number | string)[] = [];
      const Y: number[] = [];
      const Z: number[] = [];
      const T: string[] = [];
      for (const row of rows) {
        const v = cellNumber(row[measureIdx]);
        if (v === null) continue;
        const xl = cellLabel(row[xIdx]);
        const nx = numericEncode(xCol?.variableKey, xl);
        let yv = 0;
        if (seriesIdx >= 0) {
          const sl = cellLabel(row[seriesIdx]);
          yv = numericEncode(seriesCol?.variableKey, sl) ?? seriesVals.indexOf(sl);
        }
        X.push(nx ?? xl);
        Y.push(yv);
        Z.push(v);
        T.push(seriesIdx >= 0 ? `${xl} · ${cellLabel(row[seriesIdx])}` : xl);
      }
      return {
        data: [{ type: "scatter3d", mode: "markers", x: X, y: Y, z: Z, text: T, marker: { size: 4, color: Z, colorscale: "Viridis", opacity: 0.85 } }] as Record<string, unknown>[],
        ...nil,
      };
    }

    const useNumericX = chartType === "scatter" || chartType === "bubble";
    const seriesMap = new Map<string, { x: (string | number)[]; y: number[]; nx: number[] }>();
    for (const row of rows) {
      const seriesName = seriesIdx >= 0 ? cellLabel(row[seriesIdx]) : yCol?.label ?? "Value";
      const rawX = cellLabel(row[xIdx]);
      const y = cellNumber(row[measureIdx]);
      if (y === null) continue;
      const nx = numericEncode(xCol?.variableKey, rawX);
      const bucket = seriesMap.get(seriesName) ?? { x: [], y: [], nx: [] };
      bucket.x.push(useNumericX && nx !== null ? nx : rawX);
      bucket.y.push(y);
      if (nx !== null) bucket.nx.push(nx);
      seriesMap.set(seriesName, bucket);
    }

    // Fold the smallest series into "Other". A query grouped by injury
    // mechanism produces ~70 series: a legend taller than the figure, and 60
    // lines hugging zero that hide the handful that carry the data.
    if (effectiveTopN !== null && seriesIdx >= 0 && seriesMap.size > effectiveTopN + 1) {
      const ranked = [...seriesMap.entries()]
        .map(([name, b]) => [name, b.y.reduce((a, v) => a + v, 0)] as const)
        .sort((a, b) => b[1] - a[1]);
      const tail = ranked.slice(effectiveTopN).map(([name]) => name);
      foldedCount = tail.length;

      // Sum the tail per x value, so "Other" is a real series over the same
      // axis rather than a bare total.
      const otherByX = new Map<string | number, number>();
      for (const name of tail) {
        const b = seriesMap.get(name);
        if (!b) continue;
        b.x.forEach((xv, i) => otherByX.set(xv, (otherByX.get(xv) ?? 0) + b.y[i]));
        seriesMap.delete(name);
      }
      if (additive && otherByX.size > 0) {
        const xs = [...otherByX.keys()];
        seriesMap.set(OTHER_LABEL, {
          x: xs,
          y: xs.map((xv) => otherByX.get(xv) as number),
          nx: xs
            .map((xv) =>
              typeof xv === "number" ? xv : numericEncode(xCol?.variableKey, String(xv)),
            )
            .filter((n): n is number => n !== null),
        });
      }
    }

    // Optional sort (single-series bar charts only). The toggle is offered for
    // bar and pie types, but `sortDesc` survives a change of chart type and the
    // toggle is then hidden — so without the isBarLike guard, switching a
    // sorted bar chart to Line silently reorders the time axis by value, with
    // no visible control to undo it.
    const seriesEntries = [...seriesMap.entries()];
    if (sortDesc && isBarLike(chartType) && seriesEntries.length === 1 && !useNumericX) {
      const s = seriesEntries[0][1];
      const order = s.y.map((_, i) => i).sort((a, b) => s.y[b] - s.y[a]);
      s.x = order.map((i) => s.x[i]);
      s.y = order.map((i) => s.y[i]);
    }

    // For bubble sizing, scale marker area to the global max value.
    const globalMax = Math.max(1, ...seriesEntries.flatMap(([, s]) => s.y));

    const traces: Record<string, unknown>[] = [];
    let ci = 0;
    const allPairs: [number, number][] = [];
    for (const [name, s] of seriesEntries) {
      const color = colors[ci % colors.length];
      ci++;
      const base: Record<string, unknown> = {
        name,
        marker: { color, size: chartType === "scatter" ? 9 : undefined },
        line: { color, shape: smooth && (chartType === "line" || chartType === "area") ? "spline" : "linear", width: 2.5 },
      };
      if (dataLabels && !isPie) {
        base.text = s.y.map((v) => v.toLocaleString());
        base.textposition = isBarLike(chartType) ? "outside" : "top center";
      }
      if (isBarLike(chartType)) {
        traces.push({ ...base, type: "bar", orientation: horizontal ? "h" : "v", x: horizontal ? s.y : s.x, y: horizontal ? s.x : s.y });
      } else if (chartType === "area") {
        traces.push({ ...base, type: "scatter", mode: "lines", fill: seriesIdx >= 0 ? "tonexty" : "tozeroy", stackgroup: seriesIdx >= 0 ? "one" : undefined, x: s.x, y: s.y });
      } else if (chartType === "scatter") {
        traces.push({ ...base, type: "scatter", mode: dataLabels ? "markers+text" : "markers", x: s.x, y: s.y });
        s.nx.forEach((xv, i) => allPairs.push([xv, s.y[i]]));
      } else if (chartType === "bubble") {
        traces.push({
          ...base,
          type: "scatter",
          mode: "markers",
          x: s.x,
          y: s.y,
          marker: { color, sizemode: "area", sizeref: (2 * globalMax) / 40 ** 2, size: s.y.map((v) => Math.max(v, 0)), opacity: 0.7 },
        });
      } else {
        traces.push({ ...base, type: "scatter", mode: dataLabels ? "lines+markers+text" : "lines+markers", x: s.x, y: s.y });
      }
    }

    const annos: Record<string, unknown>[] = [];
    let note: string | null = null;
    if (trendline && chartType === "scatter" && allPairs.length >= 2) {
      const reg = computeRegression(allPairs);
      if (reg) {
        const xs = allPairs.map((p) => p[0]);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        traces.push({ type: "scatter", mode: "lines", name: "Trend", x: [minX, maxX], y: [reg.line(minX), reg.line(maxX)], line: { color: "#111827", dash: "dash", width: 2 }, hoverinfo: "skip" });
        const b = reg.intercept;
        note = `y = ${reg.slope.toFixed(3)}x ${b >= 0 ? "+" : "−"} ${Math.abs(b).toFixed(2)} · r² = ${reg.r2.toFixed(3)}${reg.pValue !== null ? ` · p = ${reg.pValue < 0.001 ? "<0.001" : reg.pValue.toFixed(3)}` : ""} · n = ${reg.n}`;
        annos.push({ xref: "paper", yref: "paper", x: 0.02, y: 0.98, xanchor: "left", yanchor: "top", showarrow: false, align: "left", text: note.replace(/ · /g, "<br>"), bgcolor: "rgba(255,255,255,0.85)", bordercolor: "#cbd5e1", borderwidth: 1, borderpad: 6, font: { size: 11, color: "#0f172a" } });
      }
    }

    return { data: traces, annotations: annos, regressionNote: note, folded: foldedCount };
    // logY is deliberately absent: it only affects the axis type in `layout`.
  }, [rows, table.columns, chartType, isPie, horizontal, xIdx, seriesIdx, measureIdx, palette, trendline, dataLabels, smooth, sortDesc, xCol, yCol, effectiveTopN, additive]);

  // A figure showing an "Other" slice is misleading in a report unless it says
  // what "Other" is, so the fold is recorded in the caption that travels with
  // the exported PNG and slide — not just in the on-screen note.
  const drawnCaptionLines = useMemo(() => {
    if (folded <= 0) return captionLines;
    const note = additive
      ? `Showing the largest ${effectiveTopN ?? 0}; the remaining ${folded} categories are combined as “Other”.`
      : `Showing the largest ${effectiveTopN ?? 0}; ${folded} smaller categories are not shown (rates cannot be pooled).`;
    return [...captionLines, note];
  }, [captionLines, folded, additive, effectiveTopN]);

  const legend = useMemo(() => {
    if (legendPos === "right") return { orientation: "v" as const, x: 1.02, y: 1, xanchor: "left" as const };
    if (legendPos === "top") return { orientation: "h" as const, y: 1.12, x: 0 };
    return { orientation: "h" as const, y: -0.2, x: 0 };
  }, [legendPos]);

  const layout = useMemo(() => {
    // The caption rides in the title block, not as an annotation below the plot.
    //
    // It used to be a paper-coordinate annotation at a fixed offset, which
    // assumed a one-row legend: a chart with a dozen series has a legend many
    // rows tall that grows downward and swallowed the caption. Paper offsets
    // are also a fraction of plot height, which differs between the 460px
    // on-screen plot and the 600px export, so the same offset landed in two
    // different places. Plotly lays the title block out itself, above
    // everything and clear of any legend, in both.
    const showCaption = showFilters && drawnCaptionLines.length > 0;
    const base: Record<string, unknown> = {
      title: {
        text: title || " ",
        font: { size: 16 },
        // Left-aligned: a multi-line source note centred under a centred title
        // reads as a paragraph floating over the figure.
        x: 0,
        xanchor: "left",
        xref: "paper",
        ...(showCaption
          ? {
              subtitle: {
                text: drawnCaptionLines.map((l) => `<i>${l}</i>`).join("<br>"),
                font: { size: 10, color: "#64748b" },
              },
            }
          : {}),
      },
      paper_bgcolor: "#ffffff",
      plot_bgcolor: "#ffffff",
      // Room at the top for the title plus however many caption lines.
      margin: {
        t: showCaption ? 46 + drawnCaptionLines.length * 15 : 50,
        r: 20,
        b: 60,
        l: 70,
      },
      legend,
      annotations,
      colorway: PALETTES[palette],
    };
    // 3D scatter uses a `scene` (not cartesian x/y axes).
    if (chartType === "scatter3d") {
      const seriesCol = table.columns[seriesIdx];
      return {
        ...base,
        scene: {
          xaxis: { title: { text: xTitle || xCol?.label } },
          yaxis: { title: { text: seriesIdx >= 0 ? seriesCol?.label : "" } },
          zaxis: { title: { text: yTitle || yCol?.label } },
        },
      };
    }
    // Pie/donut/treemap/sunburst are non-cartesian: no axes or barmode (setting
    // them undefined makes Plotly read `.anchor` on a missing axis and throw).
    if (NO_CARTESIAN.includes(chartType)) return base;
    return {
      ...base,
      barmode: chartType === "stackedBar" ? "stack" : "group",
      hovermode: chartType === "line" || chartType === "area" ? "x unified" : "closest",
      xaxis: { title: { text: horizontal ? yTitle || yCol?.label : xTitle || xCol?.label }, gridcolor: "#eef2f7", zeroline: false, type: horizontal && logY ? ("log" as const) : undefined },
      yaxis: { title: { text: horizontal ? xTitle || xCol?.label : yTitle || yCol?.label }, gridcolor: "#eef2f7", zeroline: false, type: !horizontal && logY ? ("log" as const) : undefined },
    };
  }, [title, xTitle, yTitle, xCol, yCol, chartType, seriesIdx, horizontal, logY, legend, annotations, palette, table.columns, showFilters, drawnCaptionLines]);

  if (measures.length === 0 || dims.length === 0) {
    return <p className="text-sm text-slate-500">No chartable data.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Chart type">
          <select value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)} className="ctrl">
            <option value="line">Line</option>
            <option value="bar">Bar (grouped)</option>
            <option value="stackedBar">Bar (stacked)</option>
            <option value="horizontalBar">Bar (horizontal)</option>
            <option value="area">Area</option>
            <option value="scatter">Scatter</option>
            <option value="bubble">Bubble</option>
            <option value="pie">Pie</option>
            <option value="donut">Donut</option>
            <option value="heatmap">Heatmap (2 dimensions)</option>
            <option value="treemap">Treemap</option>
            <option value="sunburst">Sunburst</option>
            <option value="scatter3d">3D Scatter</option>
          </select>
        </Field>
        <Field label={isPie ? "Category" : "X axis"}>
          <select
            value={xIdx}
            onChange={(e) => {
              const next = Number(e.target.value);
              setXIdx(next);
              // The series select excludes the X dimension, so a series that
              // just became X would leave the control showing a stale value
              // and plot one dimension against itself.
              if (seriesIdx === next) setSeriesIdx(-1);
            }}
            className="ctrl"
          >
            {dims.map((d) => <option key={d.index} value={d.index}>{d.column.label}</option>)}
          </select>
        </Field>
        {!isPie && (
          <Field label="Series (color)">
            <select value={seriesIdx} onChange={(e) => setSeriesIdx(Number(e.target.value))} className="ctrl">
              <option value={-1}>None</option>
              {dims.filter((d) => d.index !== xIdx).map((d) => <option key={d.index} value={d.index}>{d.column.label}</option>)}
            </select>
          </Field>
        )}
        <Field label="Measure">
          <select value={measureIdx} onChange={(e) => setMeasureIdx(Number(e.target.value))} className="ctrl">
            {measures.map((m) => <option key={m.index} value={m.index}>{m.column.label}</option>)}
          </select>
        </Field>
        <Field label="Palette">
          <select value={palette} onChange={(e) => setPalette(e.target.value)} className="ctrl">
            {Object.keys(PALETTES).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        {!isPie && (
          <Field label="Legend">
            <select value={legendPos} onChange={(e) => setLegendPos(e.target.value as "top" | "right" | "bottom")} className="ctrl">
              <option value="bottom">Bottom</option>
              <option value="right">Right</option>
              <option value="top">Top</option>
            </select>
          </Field>
        )}
      </div>

      {/* Category folding — only meaningful when something is being folded. */}
      {foldedDimIdx >= 0 && categoryCount > 5 && (
        <div className="flex flex-wrap items-center gap-3">
          <Field label={isPie ? "Slices shown" : "Series shown"}>
            <select
              value={effectiveTopN === null ? "all" : String(effectiveTopN)}
              onChange={(e) =>
                setTopN(e.target.value === "all" ? "all" : Number(e.target.value))
              }
              className="ctrl"
            >
              {TOP_N_CHOICES.filter((n) => n < categoryCount).map((n) => (
                <option key={n} value={n}>
                  Top {n}
                  {additive ? " + Other" : ""}
                </option>
              ))}
              <option value="all">Show all {categoryCount}</option>
            </select>
          </Field>
          {folded > 0 && (
            <p className="text-xs text-slate-500">
              {additive
                ? `${folded} smaller categories combined into “Other”.`
                : `${folded} smaller categories hidden — ${yCol?.label ?? "this measure"} is a rate, and rates cannot be added together.`}
            </p>
          )}
        </div>
      )}

      {/* toggles */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-700">
        <Toggle label="Data labels" checked={dataLabels} onChange={setDataLabels} />
        {captionLines.length > 0 && (
          <Toggle label="Caption + source on figure" checked={showFilters} onChange={setShowFilters} />
        )}
        {!isPie && <Toggle label="Log Y axis" checked={logY} onChange={setLogY} />}
        {(chartType === "line" || chartType === "area") && <Toggle label="Smooth" checked={smooth} onChange={setSmooth} />}
        {(isBarLike(chartType) || isPie) && <Toggle label="Sort by value" checked={sortDesc} onChange={setSortDesc} />}
        {chartType === "scatter" && <Toggle label="Trendline + r²" checked={trendline} onChange={setTrendline} />}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} className="ctrl" placeholder="Chart title" /></Field>
        {!isPie && <Field label="X label"><input value={xTitle} onChange={(e) => setXTitle(e.target.value)} className="ctrl" placeholder={xCol?.label} /></Field>}
        {!isPie && <Field label="Y label"><input value={yTitle} onChange={(e) => setYTitle(e.target.value)} className="ctrl" placeholder={yCol?.label} /></Field>}
      </div>

      {regressionNote && (
        <p className="rounded bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700">{regressionNote}</p>
      )}

      <Plot ref={plotRef} data={data} layout={layout} />

      <div className="flex gap-2">
        <button type="button" onClick={() => plotRef.current?.download("png", "wonder-portal")} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Download PNG</button>
        <button type="button" onClick={() => plotRef.current?.download("svg", "wonder-portal")} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Download SVG</button>
        <button
          type="button"
          onClick={async () => {
            const png = await plotRef.current?.toImage().catch(() => null);
            await exportPptx(
              table,
              // Both wanted: captionLines carries the grouping/filters/source
              // block, talkingPoints ships the bullets the user is reading.
              { chartType, xIdx, seriesIdx, measureIdx, title, measureLabel: yCol?.label ?? "Value", filterCaption, captionLines: drawnCaptionLines, talkingPoints },
              png ?? null,
            );
          }}
          className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
        >
          Download PPTX (editable)
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
      {label}
    </label>
  );
}
