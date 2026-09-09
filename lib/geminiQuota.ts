// Reading Gemini's 429 body.
//
// Google stopped publishing per-model free-tier limits in the documentation —
// the rate-limits page now says to look them up in AI Studio — so the only
// authoritative statement of which limit you hit and what its value is arrives
// in the error body itself. It was previously fetched and discarded, which
// meant every question about the quota had to be answered by guessing.
//
// The shape (google.rpc.QuotaFailure / google.rpc.RetryInfo):
//
//   { "error": { "code": 429, "status": "RESOURCE_EXHAUSTED", "details": [
//       { "@type": ".../google.rpc.QuotaFailure", "violations": [
//           { "quotaMetric": "...generate_content_free_tier_requests",
//             "quotaId": "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
//             "quotaDimensions": { "model": "gemini-3.5-flash-lite" },
//             "quotaValue": "15" } ] },
//       { "@type": ".../google.rpc.RetryInfo", "retryDelay": "31s" } ] } }
//
// Everything here is defensive: this is an external format that has changed
// before and will change again, and a parse failure must degrade to "we don't
// know" rather than throw inside an error handler.

export interface QuotaViolation {
  quotaId: string | null;
  quotaValue: string | null;
  model: string | null;
  metric: string | null;
}

export interface QuotaFailure {
  violations: QuotaViolation[];
  /** From RetryInfo, in seconds. Null when Google did not say. */
  retryDelaySeconds: number | null;
  /**
   * True when every violation is scoped to a single model, so a different
   * model may still serve. False when any violation is project-wide, or when
   * there is nothing to go on — in which case the caller should not assume a
   * fallback will help.
   */
  perModelOnly: boolean;
  /** True when a violation names a per-day quota rather than a per-minute one. */
  daily: boolean;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** "31s", "1.5s" -> seconds. Google sends a protobuf Duration string. */
function durationSeconds(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const m = /^([0-9]+(?:\.[0-9]+)?)s$/.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function parseQuotaFailure(body: string): QuotaFailure | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const error = asRecord(asRecord(parsed)?.error);
  const details = error?.details;
  if (!Array.isArray(details)) return null;

  const violations: QuotaViolation[] = [];
  let retryDelaySeconds: number | null = null;

  for (const entry of details) {
    const d = asRecord(entry);
    if (!d) continue;
    const type = str(d["@type"]) ?? "";
    if (type.endsWith("QuotaFailure") && Array.isArray(d.violations)) {
      for (const raw of d.violations) {
        const v = asRecord(raw);
        if (!v) continue;
        violations.push({
          quotaId: str(v.quotaId),
          quotaValue: str(v.quotaValue),
          model: str(asRecord(v.quotaDimensions)?.model),
          metric: str(v.quotaMetric),
        });
      }
    } else if (type.endsWith("RetryInfo")) {
      retryDelaySeconds = durationSeconds(d.retryDelay);
    }
  }

  if (violations.length === 0 && retryDelaySeconds === null) return null;

  // "PerModel" in the quota id is Google's own scoping marker. With no
  // violations at all there is nothing to go on, and claiming per-model would
  // send the caller round the whole fallback chain for nothing.
  const perModelOnly =
    violations.length > 0 && violations.every((v) => /PerModel/i.test(v.quotaId ?? ""));
  const daily = violations.some((v) => /PerDay/i.test(v.quotaId ?? ""));

  return { violations, retryDelaySeconds, perModelOnly, daily };
}

/** A compact one-line rendering for the server log. */
export function describeQuota(f: QuotaFailure): string {
  const parts = f.violations.map((v) => {
    const id = v.quotaId ?? v.metric ?? "unknown quota";
    const value = v.quotaValue ? ` limit=${v.quotaValue}` : "";
    const model = v.model ? ` model=${v.model}` : "";
    return `${id}${value}${model}`;
  });
  if (f.retryDelaySeconds !== null) parts.push(`retryDelay=${f.retryDelaySeconds}s`);
  return parts.length > 0 ? parts.join("; ") : "no quota detail";
}

/**
 * What to tell the visitor.
 *
 * The two cases have genuinely different answers — wait half a minute, or come
 * back tomorrow — and the message should only claim to know which when the
 * body actually said.
 */
export function quotaMessage(f: QuotaFailure | null): string {
  const tail =
    " The talking points below are computed directly from the data and do not need the AI.";
  if (f?.daily) {
    return (
      "AI analysis has reached its daily free-tier limit, which resets at midnight Pacific." + tail
    );
  }
  if (f?.retryDelaySeconds !== null && f?.retryDelaySeconds !== undefined) {
    const secs = Math.max(1, Math.ceil(f.retryDelaySeconds));
    return `AI analysis is rate-limited for about ${secs} more second${secs === 1 ? "" : "s"}. Try again shortly.${tail}`;
  }
  return (
    "AI analysis is rate-limited right now. This usually clears within a minute — try again shortly." +
    " If it keeps happening, the daily free-tier limit has been reached and resets at midnight Pacific." +
    tail
  );
}
