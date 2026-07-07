// plotly.js-dist-min ships no types; we use a permissive shape. The wrapper in
// components/Plot.tsx is the only place that touches the Plotly runtime.
declare module "plotly.js-dist-min" {
  const Plotly: {
    react: (
      el: HTMLElement,
      data: unknown[],
      layout?: unknown,
      config?: unknown,
    ) => Promise<void>;
    purge: (el: HTMLElement) => void;
    downloadImage: (el: HTMLElement, opts: unknown) => Promise<string>;
    toImage: (el: HTMLElement, opts: unknown) => Promise<string>;
  };
  export default Plotly;
}
