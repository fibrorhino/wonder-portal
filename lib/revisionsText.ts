// Rendering a revision report as a sentence.
//
// Separate from lib/revisions.ts because that module reads and writes the
// history file and so imports node:fs. This one is pure, so the browser can
// import it without dragging the filesystem into the client bundle.

import type { RevisionReport } from "./wonder/types";

/** "Since Aug 12, 2026: 2025 revised up 412 deaths (+0.8%)." */
export function describeRevisions(report: RevisionReport): string {
  const when = new Date(report.previousObservedAt);
  const on = Number.isNaN(when.getTime())
    ? "the previous check"
    : when.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const parts = report.changes.map((c) => {
    // "revised down 84" reads; "revised up -84" does not.
    const dir = c.delta > 0 ? "up" : "down";
    const size = Math.abs(c.delta);
    const pct = c.pct === null ? "" : ` (${c.delta > 0 ? "+" : ""}${c.pct.toFixed(1)}%)`;
    // WONDER's "2025 (provisional)" belongs on an axis, not mid-sentence; that
    // these are provisional figures is the entire point of the notice.
    const period = c.period.replace(/\s*\(.*\)\s*$/, "");
    return `${period} revised ${dir} ${size.toLocaleString("en-US")} death${size === 1 ? "" : "s"}${pct}`;
  });
  return `Since ${on}: ${parts.join("; ")}.`;
}
