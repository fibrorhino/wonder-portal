"use client";

// Thin client-only wrapper over plotly.js-dist-min. Loaded dynamically so Plotly
// never runs during SSR. Exposes an imperative PNG/SVG download via ref.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type Plotly from "plotly.js-dist-min";

export interface PlotHandle {
  download: (format: "png" | "svg", filename: string) => void;
  toImage: () => Promise<string | null>;
}

interface PlotProps {
  data: unknown[];
  layout?: Record<string, unknown>;
  className?: string;
}

const Plot = forwardRef<PlotHandle, PlotProps>(function Plot(
  { data, layout, className },
  ref,
) {
  const elRef = useRef<HTMLDivElement>(null);
  const plotlyRef = useRef<typeof Plotly | null>(null);
  const traceTypesRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const mod = (await import("plotly.js-dist-min")).default;
      if (!mounted || !elRef.current) return;
      plotlyRef.current = mod;
      // Switching between fundamentally different trace types (e.g. cartesian
      // -> pie) leaves stale axes behind, so purge in that case only. For
      // everything else — toggling data labels, recolouring, sorting —
      // Plotly.react updates in place, which avoids a full redraw flash and
      // keeps the user's zoom/pan.
      const traceTypes = data
        .map((d) => (d as { type?: string })?.type ?? "")
        .join(",");
      if (traceTypesRef.current !== null && traceTypesRef.current !== traceTypes) {
        mod.purge(elRef.current);
      }
      traceTypesRef.current = traceTypes;
      await mod.react(elRef.current, data, {
        margin: { t: 40, r: 20, b: 60, l: 70 },
        font: { family: "Arial, Helvetica, sans-serif" },
        autosize: true,
        ...layout,
      }, { responsive: true, displaylogo: false });
    })();
    return () => {
      mounted = false;
    };
  }, [data, layout]);

  // Tear the plot down only when the component actually unmounts.
  useEffect(() => {
    const el = elRef.current;
    return () => {
      if (el && plotlyRef.current) plotlyRef.current.purge(el);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    download(format, filename) {
      if (elRef.current && plotlyRef.current) {
        plotlyRef.current.downloadImage(elRef.current, {
          format,
          filename,
          width: 1000,
          height: 600,
          scale: 2,
        });
      }
    },
    async toImage() {
      if (elRef.current && plotlyRef.current) {
        return plotlyRef.current.toImage(elRef.current, {
          format: "png",
          width: 1000,
          height: 600,
          scale: 2,
        });
      }
      return null;
    },
  }));

  return <div ref={elRef} className={className} style={{ width: "100%", height: 460 }} />;
});

export default Plot;
