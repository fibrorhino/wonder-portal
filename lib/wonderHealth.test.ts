// Tests for the CDC health tracker behind /api/health.

import test from "node:test";
import assert from "node:assert/strict";
import {
  __resetHealthForTests,
  healthSnapshot,
  recordCacheHit,
  recordCdcFailure,
  recordCdcSuccess,
} from "./wonderHealth";

test("a fresh process reports ok, not unknown", () => {
  // An idle night must not trip a monitor keyed on "cdc":"ok".
  __resetHealthForTests();
  const h = healthSnapshot();
  assert.equal(h.cdc, "ok");
  assert.equal(h.ok, true);
  assert.equal(h.lastSuccess, null);
  assert.match(h.detail, /no queries since startup/);
});

test("a single failure stays below the alert threshold", () => {
  __resetHealthForTests();
  recordCdcFailure("HTTP 403");
  const h = healthSnapshot();
  assert.equal(h.cdc, "ok", "one blip should not alert");
  assert.equal(h.consecutiveFailures, 1);
});

test("two consecutive failures report failing", () => {
  __resetHealthForTests();
  recordCdcFailure("HTTP 403");
  recordCdcFailure("HTTP 403");
  const h = healthSnapshot();
  assert.equal(h.cdc, "failing");
  assert.equal(h.ok, false);
  assert.equal(h.consecutiveFailures, 2);
  assert.ok(h.lastFailure, "lastFailure timestamp should be set");
});

test("a success clears the consecutive-failure run", () => {
  __resetHealthForTests();
  recordCdcFailure("HTTP 403");
  recordCdcFailure("HTTP 403");
  assert.equal(healthSnapshot().cdc, "failing");

  recordCdcSuccess();
  const h = healthSnapshot();
  assert.equal(h.cdc, "ok");
  assert.equal(h.consecutiveFailures, 0);
  assert.match(h.detail, /last query succeeded/);
});

test("counters track calls, failures and cache hits separately", () => {
  __resetHealthForTests();
  recordCdcSuccess();
  recordCdcFailure("boom");
  recordCdcSuccess();
  recordCacheHit();
  recordCacheHit();

  const h = healthSnapshot();
  assert.equal(h.queries.cdcCalls, 3, "cache hits are not CDC calls");
  assert.equal(h.queries.failed, 1);
  assert.equal(h.queries.cacheHits, 2);
});

test("cache hits alone never make it look unhealthy", () => {
  __resetHealthForTests();
  recordCacheHit();
  recordCacheHit();
  const h = healthSnapshot();
  assert.equal(h.cdc, "ok");
  assert.equal(h.queries.cdcCalls, 0);
});

test("failure reasons are truncated so the endpoint stays small", () => {
  __resetHealthForTests();
  for (let i = 0; i < 12; i++) recordCdcFailure("x".repeat(5000));
  const h = healthSnapshot();
  assert.equal(h.consecutiveFailures, 12);
  assert.equal(h.recentFailures.length, 5, "only the last few are kept");
  assert.ok(h.recentFailures.every((f) => f.reason.length <= 200));
  assert.ok(JSON.stringify(h).length < 2000, "health payload should stay small");
});

// "3 consecutive CDC failures" was all the endpoint said, which cannot tell a
// block from a timeout from a query CDC refused. The reasons were recorded all
// along and never returned.
test("the reasons for recent failures are reported, newest first", () => {
  __resetHealthForTests();
  recordCdcFailure("HTTP 403: (no detail)");
  recordCdcFailure("unreachable: fetch failed");
  const h = healthSnapshot();
  assert.deepEqual(
    h.recentFailures.map((f) => f.reason),
    ["unreachable: fetch failed", "HTTP 403: (no detail)"],
  );
  assert.ok(!Number.isNaN(Date.parse(h.recentFailures[0].at)));
  // A later success clears the alarm but keeps the history readable.
  recordCdcSuccess();
  assert.equal(healthSnapshot().cdc, "ok");
  assert.equal(healthSnapshot().recentFailures.length, 2);
});
