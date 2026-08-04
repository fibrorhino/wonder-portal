// Records the outcome of CDC WONDER calls so /api/health can report whether
// queries actually work — something a check of the home page cannot tell you,
// because the page renders fine while every query 403s.
//
// PASSIVE BY DESIGN: this only observes calls that real users already made. It
// never issues its own request to CDC. WONDER requires 15 seconds between
// requests, so a monitor that fired its own query every few minutes would be
// exactly the behaviour that gets an IP blocked.
//
// State is per-process and resets when the service restarts, the same as the
// response cache and the rate-limit pacing in app/api/wonder/route.ts. That is
// correct for the single always-on server this runs on.

/** Consecutive failures before we call CDC "failing" rather than a blip. */
const FAILING_THRESHOLD = 2;

/** Keep the last few failure reasons for a human reading the endpoint. */
const RECENT_FAILURES_KEPT = 5;

interface RecentFailure {
  at: string;
  reason: string;
}

const state = {
  startedAt: Date.now(),
  lastSuccessAt: null as number | null,
  lastFailureAt: null as number | null,
  consecutiveFailures: 0,
  totalCdcCalls: 0,
  totalFailures: 0,
  cacheHits: 0,
  recentFailures: [] as RecentFailure[],
};

export function recordCacheHit(): void {
  state.cacheHits++;
}

export function recordCdcSuccess(): void {
  state.totalCdcCalls++;
  state.lastSuccessAt = Date.now();
  state.consecutiveFailures = 0;
}

export function recordCdcFailure(reason: string): void {
  state.totalCdcCalls++;
  state.totalFailures++;
  state.lastFailureAt = Date.now();
  state.consecutiveFailures++;
  state.recentFailures.unshift({
    at: new Date().toISOString(),
    reason: reason.slice(0, 200),
  });
  state.recentFailures.length = Math.min(
    state.recentFailures.length,
    RECENT_FAILURES_KEPT,
  );
}

export interface HealthSnapshot {
  ok: boolean;
  /** "ok" | "failing" — what an uptime monitor should key on. */
  cdc: "ok" | "failing";
  detail: string;
  lastSuccess: string | null;
  lastFailure: string | null;
  consecutiveFailures: number;
  queries: { cdcCalls: number; failed: number; cacheHits: number };
  startedAt: string;
  uptimeSeconds: number;
}

export function healthSnapshot(): HealthSnapshot {
  const failing = state.consecutiveFailures >= FAILING_THRESHOLD;

  // "No queries yet" reports as ok on purpose. A quiet night is not evidence
  // of a problem, and reporting "unknown" would make an uptime monitor keyed
  // on "cdc":"ok" alert every time nobody used the site for a while.
  let detail: string;
  if (failing) {
    detail = `${state.consecutiveFailures} consecutive CDC failures — queries are not working`;
  } else if (state.totalCdcCalls === 0) {
    detail = "no queries since startup (nothing known to be wrong)";
  } else if (state.consecutiveFailures > 0) {
    detail = `${state.consecutiveFailures} recent failure(s), below the alert threshold of ${FAILING_THRESHOLD}`;
  } else {
    detail = "last query succeeded";
  }

  return {
    ok: !failing,
    cdc: failing ? "failing" : "ok",
    detail,
    lastSuccess: state.lastSuccessAt ? new Date(state.lastSuccessAt).toISOString() : null,
    lastFailure: state.lastFailureAt ? new Date(state.lastFailureAt).toISOString() : null,
    consecutiveFailures: state.consecutiveFailures,
    queries: {
      cdcCalls: state.totalCdcCalls,
      failed: state.totalFailures,
      cacheHits: state.cacheHits,
    },
    startedAt: new Date(state.startedAt).toISOString(),
    uptimeSeconds: Math.round((Date.now() - state.startedAt) / 1000),
  };
}

/** Test seam — resets the module state. */
export function __resetHealthForTests(): void {
  state.startedAt = Date.now();
  state.lastSuccessAt = null;
  state.lastFailureAt = null;
  state.consecutiveFailures = 0;
  state.totalCdcCalls = 0;
  state.totalFailures = 0;
  state.cacheHits = 0;
  state.recentFailures = [];
}
