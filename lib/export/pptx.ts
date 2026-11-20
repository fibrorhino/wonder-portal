// Export a figure to an editable PowerPoint (.pptx). For the common chart types
// we emit a NATIVE PowerPoint chart (fully editable in PowerPoint — recolor,
// retype, edit data). For types PowerPoint can't represent natively (heatmap,
// treemap, sunburst, 3D, bubble) we embed the high-res PNG instead. Talking
// points are added as bullet text.

import type { ResultTable } from "@/lib/wonder/types";
import { cellLabel, cellNumber, dataRows } from "@/lib/tableUtils";

export interface PptxChartConfig {
  chartType: string;
  xIdx: number;
  seriesIdx: number; // -1 for none
  measureIdx: number;
  title: string;
  measureLabel: string;
  /** Human-readable summary of the active filters, shown under the title. */
  filterCaption?: string;
  /** Caption lines (grouping / filters / source) drawn under the title. */
  captionLines?: string[];
  /**
   * The bullets to put on the slide. Passed in rather than recomputed so the
   * deck matches what the user is looking at: if they ran the AI analysis, the
   * verified wording is exported, not a freshly regenerated raw set.
   */
  talkingPoints: string[];
  /**
   * The series exactly as the on-screen figure drew them: other grouping
   * variables combined or narrowed, the tail folded, sorted, months relabelled.
   * Rebuilding them here from the raw rows added up anything that shared an x
   * value, so a three-variable table became one series of sums, and rates were
   * summed into numbers that are not rates.
   */
  series?: PptxSeries[];
  /** Stack the bars. Never set for a rate. */
  stacked?: boolean;
  /** The database the figure came from, for the source line. */
  sourceLabel?: string;
}

export interface PptxSeries {
  name: string;
  labels: string[];
  /** null is a gap on the slide, not a zero. */
  values: (number | null)[];
}

// chartType -> native PowerPoint chart, or null to fall back to an image.
function nativeType(chartType: string): { type: string; opts: Record<string, unknown> } | null {
  switch (chartType) {
    case "line":
      return { type: "line", opts: {} };
    case "area":
      return { type: "area", opts: {} };
    case "bar":
      return { type: "bar", opts: { barDir: "col", barGrouping: "clustered" } };
    case "stackedBar":
      return { type: "bar", opts: { barDir: "col", barGrouping: "stacked" } };
    case "horizontalBar":
      return { type: "bar", opts: { barDir: "bar", barGrouping: "clustered" } };
    case "pie":
      return { type: "pie", opts: {} };
    case "donut":
      return { type: "doughnut", opts: { holeSize: 50 } };
    default:
      return null; // scatter, bubble, heatmap, treemap, sunburst, scatter3d
  }
}

function buildSeries(table: ResultTable, cfg: PptxChartConfig) {
  const rows = dataRows(table);
  const xVals: string[] = [];
  const xseen = new Set<string>();
  const seriesNames: string[] = [];
  const sseen = new Set<string>();
  const vmap = new Map<string, number>();

  for (const row of rows) {
    const x = cellLabel(row[cfg.xIdx]);
    const s = cfg.seriesIdx >= 0 ? cellLabel(row[cfg.seriesIdx]) : cfg.measureLabel;
    const v = cellNumber(row[cfg.measureIdx]);
    if (v === null) continue;
    if (!xseen.has(x)) { xseen.add(x); xVals.push(x); }
    if (!sseen.has(s)) { sseen.add(s); seriesNames.push(s); }
    vmap.set(s + "||" + x, (vmap.get(s + "||" + x) ?? 0) + v);
  }
  return { xVals, seriesNames, vmap };
}

export async function exportPptx(
  table: ResultTable,
  cfg: PptxChartConfig,
  pngDataUrl: string | null,
) {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
  pptx.layout = "WIDE";

  const slide = pptx.addSlide();
  const title = cfg.title || "CDC WONDER figure";
  slide.addText(title, { x: 0.5, y: 0.3, w: 12.3, h: 0.5, fontSize: 22, bold: true, color: "002D72" });
  // One block, newline-separated, so the source line travels with the slide.
  const captionLines = cfg.captionLines?.length
    ? cfg.captionLines
    : cfg.filterCaption
      ? [cfg.filterCaption]
      : [];
  if (captionLines.length) {
    slide.addText(captionLines.join(String.fromCharCode(10)), {
      x: 0.5, y: 0.78, w: 12.3, h: 0.16 * (captionLines.length + 1),
      fontSize: 10, italic: true, color: "64748B", lineSpacingMultiple: 1.0,
    });
  }

  const native = nativeType(cfg.chartType);
  let chartData: PptxSeries[];
  if (cfg.series && cfg.series.length > 0) {
    chartData = cfg.series;
  } else {
    const { xVals, seriesNames, vmap } = buildSeries(table, cfg);
    chartData =
      native?.type === "pie" || native?.type === "doughnut"
        ? [
            {
              name: cfg.measureLabel,
              labels: xVals,
              values: xVals.map((x) => seriesNames.reduce((a, s) => a + (vmap.get(s + "||" + x) ?? 0), 0)),
            },
          ]
        : seriesNames.map((s) => ({ name: s, labels: xVals, values: xVals.map((x) => vmap.get(s + "||" + x) ?? null) }));
  }
  const seriesNames = chartData.map((c) => c.name);
  const hasData = chartData.some((c) => c.labels.length > 0);
  // Stacking is decided by the caller, which knows whether the measure adds up.
  const opts =
    native && cfg.chartType === "stackedBar" && cfg.series && !cfg.stacked
      ? { ...native.opts, barGrouping: "clustered" }
      : native?.opts;

  if (native && hasData) {
    slide.addChart(native.type as never, chartData as never, {
      x: 0.5,
      y: 1.1,
      w: 8.3,
      h: 5.6,
      showTitle: false,
      showLegend: seriesNames.length > 1 || native.type === "pie" || native.type === "doughnut",
      legendPos: "b",
      chartColors: ["2563EB", "DC2626", "16A34A", "D97706", "7C3AED", "0891B2", "DB2777", "65A30D"],
      ...opts,
    });
  } else if (pngDataUrl) {
    slide.addImage({ data: pngDataUrl, x: 0.5, y: 1.1, w: 8.3, h: 5.0 });
    slide.addText("(Chart type embedded as an image; use a bar/line/pie type for a fully editable chart.)", {
      x: 0.5, y: 6.2, w: 8.3, h: 0.4, fontSize: 9, italic: true, color: "888888",
    });
  } else {
    slide.addText("No chart data available.", { x: 0.5, y: 3, w: 8, h: 1, fontSize: 14 });
  }

  // Talking points panel on the right.
  const points = cfg.talkingPoints;
  slide.addText("Talking points", { x: 9.1, y: 1.1, w: 3.7, h: 0.4, fontSize: 14, bold: true, color: "002D72" });
  slide.addText(
    points.map((p) => ({ text: p, options: { bullet: true, fontSize: 11, color: "333333", paraSpaceAfter: 6 } })),
    { x: 9.1, y: 1.55, w: 3.75, h: 4.8, valign: "top" },
  );

  // Named for the dataset the figure actually came from. This line was fixed
  // text naming the 2018-2024 file, so a slide built from the provisional,
  // 1999-2020 or combined data cited a file it did not use.
  slide.addText(
    `Source: CDC/NCHS, ${cfg.sourceLabel ?? "CDC WONDER"}, via CDC WONDER. National data. Generated by the Mortality Data Portal.`,
    { x: 0.5, y: 7.0, w: 12.3, h: 0.35, fontSize: 8, color: "888888" },
  );

  await pptx.writeFile({ fileName: "wonder-portal.pptx" });
}
