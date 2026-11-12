// One way of calling Gemini, shared by both routes that use it.
//
// The retry-and-fall-back logic was written for /api/insights after
// gemini-2.5-flash stopped serving new callers with a 404 and took the feature
// down. /api/nl never got it: it stayed pinned to a single model id, ignored
// the GEMINI_MODEL override, and on any failure showed the visitor the first
// 300 characters of Google's JSON error body. The two routes spend the same
// free-tier quota and fail in the same ways, so they now share this.
//
// What it does, per model in order:
//   - 503 ("overloaded"): up to three tries with a short backoff, then move on.
//   - 404 (model id retired): move on at once.
//   - 429 with a PER-MODEL quota: move on, because the next model has its own
//     allowance. A project-wide 429, or one whose body does not say, stops:
//     another model would hit the same wall.
//   - anything else: stop. Trying another model will not fix a bad key.

import { describeQuota, parseQuotaFailure, type QuotaFailure } from "./geminiQuota";

// Models in preference order. Pinned ids rather than a floating alias, so the
// behaviour only changes when this list does.
//
// Flash-Lite leads: this site is public and runs on the free tier, and the
// model is not doing the arithmetic — every figure is supplied by the fact
// sheet and checked afterwards — so the cheaper model with the higher quota is
// the right default. GEMINI_MODEL overrides it without a code change.
export const DEFAULT_GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-3.6-flash",
];

/** The chain to try: the override first when there is one, then the defaults. */
export function geminiModelChain(override: string | undefined): string[] {
  const first = override?.trim();
  return first
    ? [first, ...DEFAULT_GEMINI_MODELS.filter((m) => m !== first)]
    : [...DEFAULT_GEMINI_MODELS];
}

const modelUrl = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export type GeminiResult =
  | { ok: true; model: string; data: unknown }
  | {
      ok: false;
      /** HTTP status of the last response, or null when nothing answered. */
      status: number | null;
      /** The last response body, or the network error. For logs, not visitors. */
      detail: string;
      quota: QuotaFailure | null;
      /** The model the last attempt was made against. */
      model: string;
    };

export interface GeminiCallOptions {
  key: string;
  /** The JSON request body, already serialised. */
  body: string;
  models: string[];
  timeoutMs: number;
  /** Prefix for log lines, e.g. "insights". */
  tag: string;
  /** Test seams. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  warn?: (message: string) => void;
}

export async function callGemini(options: GeminiCallOptions): Promise<GeminiResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const warn = options.warn ?? ((m: string) => console.warn(m));

  let status: number | null = null;
  let detail = "no response";
  let quota: QuotaFailure | null = null;
  let model = options.models[0] ?? "";

  outer: for (const candidate of options.models) {
    model = candidate;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(800 * attempt);
      let res: Response;
      try {
        res = await doFetch(`${modelUrl(candidate)}?key=${encodeURIComponent(options.key)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: options.body,
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (e) {
        // The key is in the URL, and some runtimes put the URL in the error.
        const message = (e instanceof Error ? e.message : String(e)).split(options.key).join("[key]");
        return { ok: false, status: null, detail: message, quota: null, model };
      }

      if (res.ok) {
        try {
          return { ok: true, model: candidate, data: await res.json() };
        } catch {
          return { ok: false, status: res.status, detail: "response was not JSON", quota: null, model };
        }
      }

      // A body can only be read once, so it is read here and carried forward.
      status = res.status;
      detail = await res.text().catch(() => "");
      quota = null;

      // 404 means this model id is gone — move on rather than retrying it.
      if (status === 404) {
        warn(`[${options.tag}] ${candidate} returned 404: model id retired or misspelt`);
        break;
      }
      if (status === 429) {
        quota = parseQuotaFailure(detail);
        // Google no longer publishes the free-tier numbers, so this line is
        // the only record of which limit was hit and what its value is.
        warn(
          `[${options.tag}] 429 from ${candidate}: ${quota ? describeQuota(quota) : detail.slice(0, 200)}`,
        );
        if (quota?.perModelOnly) break;
        break outer;
      }
      if (status !== 503) {
        warn(`[${options.tag}] HTTP ${status} from ${candidate}: ${detail.slice(0, 200)}`);
        break outer;
      }
      // 503: loop to retry this model; after the third, fall to the next.
    }
  }

  return { ok: false, status, detail, quota, model };
}

/** The text of the first candidate in a generateContent response, if any. */
export function geminiText(data: unknown): string | null {
  const text = (
    data as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] } | null
  )?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === "string" && text.length > 0 ? text : null;
}
