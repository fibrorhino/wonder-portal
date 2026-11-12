// The point of these messages is that a visitor can tell whose problem it is.
// These tests assert that intent, not exact prose.

import test from "node:test";
import assert from "node:assert/strict";
import {
  cdcBusyMessage,
  cdcHttpErrorMessage,
  cdcNetworkErrorMessage,
  isQueryRejection,
} from "./cdcErrors";

const blamesCdc = (m: string) => /CDC/.test(m);
const saysNotUs = (m: string) => /not a problem with this site|not with this site/i.test(m);
const suggestsRetry = (m: string) => /try again|run the query again/i.test(m);

test("a 403 blames CDC, exonerates the site, and says when to retry", () => {
  const m = cdcHttpErrorMessage(403, null);
  assert.ok(blamesCdc(m), m);
  assert.ok(saysNotUs(m), "must say it is not this site's fault");
  assert.ok(suggestsRetry(m), "must tell the visitor to try again");
  assert.ok(/minute/.test(m), "must give a concrete wait");
});

test("a 403 never leaks operator-only advice", () => {
  const m = cdcHttpErrorMessage(403, "Forbidden");
  // The old wording told visitors to restart the app, which only Paul can do.
  assert.ok(!/restart/i.test(m), "must not tell a visitor to restart anything");
  assert.ok(!/this server|edge/i.test(m), "must not expose server internals");
});

test("429 and 5xx are also attributed to CDC", () => {
  for (const status of [429, 500, 502, 503]) {
    const m = cdcHttpErrorMessage(status, null);
    assert.ok(blamesCdc(m), `${status}: ${m}`);
    assert.ok(saysNotUs(m), `${status} must exonerate the site`);
    assert.ok(suggestsRetry(m), `${status} must suggest a retry`);
  }
});

test("a 4xx that carries CDC's own explanation surfaces it", () => {
  // These are usually about the query itself, so the visitor needs the detail.
  const m = cdcHttpErrorMessage(400, "Invalid ICD-10 code: ZZZ");
  assert.ok(m.includes("Invalid ICD-10 code: ZZZ"), m);
});

test("a 4xx with no detail still reads as actionable", () => {
  const m = cdcHttpErrorMessage(400, null);
  assert.ok(blamesCdc(m), m);
  assert.ok(suggestsRetry(m), m);
});

test("a timeout explains the cause and suggests narrowing the query", () => {
  const err = new Error("The operation was aborted due to timeout");
  err.name = "TimeoutError";
  const m = cdcNetworkErrorMessage(err);
  assert.ok(blamesCdc(m), m);
  assert.ok(/narrow/i.test(m), "must suggest narrowing the query");
  assert.ok(!/undefined|\[object/.test(m), "must not leak raw error internals");
});

test("an unreachable host reads as a CDC outage, not a site fault", () => {
  const m = cdcNetworkErrorMessage(new Error("fetch failed"));
  assert.ok(blamesCdc(m), m);
  assert.ok(suggestsRetry(m), m);
  assert.ok(!/fetch failed/.test(m), "must not surface the raw network error");
});

test("a non-Error rejection does not produce garbage", () => {
  const m = cdcNetworkErrorMessage("something odd");
  assert.ok(blamesCdc(m), m);
  assert.ok(!/undefined|\[object/.test(m), m);
});

// CDC refuses a query it will not run with HTTP 500 and a sentence saying why.
// Both strings below are CDC's own, captured from the live API.
const RACE_REFUSAL =
  "Age Adjusted Rates are not available when values are selected for Single Race 15 or " +
  "Single/Multi Race 31 in section 3, or if these variables appear in Group Results By list " +
  "in section 1.  Uncheck the Age Adjusted Rates checkbox.";

test("a 500 that explains itself is shown as a refusal, not as an outage", () => {
  const m = cdcHttpErrorMessage(500, RACE_REFUSAL);
  assert.ok(m.includes("Age Adjusted Rates are not available"), m);
  // "Temporarily unavailable, try again in a minute" was what this produced,
  // for a query that fails identically every time it is run.
  assert.ok(!/temporarily unavailable/i.test(m), m);
  assert.ok(!/try again/i.test(m), m);
  assert.ok(!m.endsWith(".."), "no doubled full stop");
});

test("a refusal is not an outage; a block or a silent 500 is", () => {
  assert.equal(isQueryRejection(500, RACE_REFUSAL), true);
  assert.equal(isQueryRejection(400, "Invalid ICD-10 code: ZZZ"), true);
  // Nothing to go on: treat as CDC being unwell.
  assert.equal(isQueryRejection(500, null), false);
  assert.equal(isQueryRejection(502, "   "), false);
  // The edge turning this server away is never about the query, whatever the
  // body says.
  assert.equal(isQueryRejection(403, "Forbidden"), false);
  assert.equal(isQueryRejection(429, "Too many requests"), false);
});

test("a full queue is explained as a wait, without blaming CDC's servers", () => {
  const m = cdcBusyMessage();
  assert.ok(/15 seconds/.test(m), m);
  assert.ok(suggestsRetry(m) || /run it again/i.test(m), m);
  assert.ok(!/unavailable/i.test(m), m);
});
