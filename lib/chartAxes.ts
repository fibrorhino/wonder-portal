// Which Plotly axis type each chart type needs.
//
// This exists as a separate, tested function because getting it wrong loses
// data silently. Plotly infers the axis type from the values when none is
// given, and a list of year labels looks numeric — so it picks "linear" and
// then drops every label that does not parse as a number. On the provisional
// dataset that removed "2025 (provisional)" and "2026 (provisional and
// partial)" from trend charts while 2018-2024 stayed: the points were in the
// trace, the axis refused to plot them, and nothing anywhere reported an error.
//
// A category axis must therefore be declared explicitly wherever the labels are
// categories, which is everywhere except the two chart types that genuinely
// plot a number on x, and the horizontal bar, which swaps the roles.

export type AxisType = "category" | "log" | undefined;

/** Chart types whose x values are real numbers, not category labels. */
const NUMERIC_X = new Set(["scatter", "bubble"]);

export function axisTypes(
  chartType: string,
  logY: boolean,
): { x: AxisType; y: AxisType } {
  // Horizontal bars put the measure on x and the categories on y.
  const horizontal = chartType === "horizontalBar";
  const numericX = NUMERIC_X.has(chartType);

  const xIsCategory = !horizontal && !numericX;
  const yIsCategory = horizontal;

  return {
    x: xIsCategory ? "category" : horizontal && logY ? "log" : undefined,
    y: yIsCategory ? "category" : !horizontal && logY ? "log" : undefined,
  };
}
