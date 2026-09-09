import test from "node:test";
import assert from "node:assert/strict";
import { describeQuota, parseQuotaFailure, quotaMessage } from "./geminiQuota";

// A real free-tier per-minute 429, trimmed to the fields that matter.
const PER_MINUTE = JSON.stringify({
  error: {
    code: 429,
    message: "You exceeded your current quota, please check your plan and billing details.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          {
            quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
            quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
            quotaDimensions: { model: "gemini-3.5-flash-lite", location: "global" },
            quotaValue: "15",
          },
        ],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "31s" },
    ],
  },
});

const PER_DAY = JSON.stringify({
  error: {
    code: 429,
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          {
            quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
            quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
            quotaDimensions: { model: "gemini-3.5-flash-lite" },
            quotaValue: "1000",
          },
        ],
      },
    ],
  },
});

test("the per-minute quota is read out of the body, value and all", () => {
  const f = parseQuotaFailure(PER_MINUTE);
  assert.ok(f);
  assert.equal(f.violations.length, 1);
  assert.equal(f.violations[0].quotaValue, "15");
  assert.equal(f.violations[0].model, "gemini-3.5-flash-lite");
  assert.equal(f.retryDelaySeconds, 31);
  assert.equal(f.daily, false);
  // This is the point of the whole module: knowing the limit is scoped to one
  // model is what makes trying the next one worthwhile.
  assert.equal(f.perModelOnly, true);
});

test("a per-day quota is distinguished from a per-minute one", () => {
  const f = parseQuotaFailure(PER_DAY);
  assert.ok(f);
  assert.equal(f.daily, true);
  assert.equal(f.violations[0].quotaValue, "1000");
  assert.match(quotaMessage(f), /daily free-tier limit/);
  assert.match(quotaMessage(f), /midnight Pacific/);
});

test("the retry delay is quoted to the visitor when Google supplied one", () => {
  assert.match(quotaMessage(parseQuotaFailure(PER_MINUTE)), /about 31 more seconds/);
});

test("with nothing to go on the message does not claim to know which limit", () => {
  const m = quotaMessage(null);
  assert.match(m, /usually clears within a minute/);
  assert.match(m, /talking points below/);
});

test("a project-wide violation is not reported as per-model", () => {
  // Falling through the model list would be pointless here, and would spend
  // three requests to learn nothing.
  const body = JSON.stringify({
    error: {
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [{ quotaId: "GenerateRequestsPerDayPerProject-FreeTier", quotaValue: "50" }],
        },
      ],
    },
  });
  const f = parseQuotaFailure(body);
  assert.ok(f);
  assert.equal(f.perModelOnly, false);
});

test("a mix of per-model and project-wide is treated as project-wide", () => {
  const body = JSON.stringify({
    error: {
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [
            { quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier", quotaValue: "15" },
            { quotaId: "GenerateRequestsPerDayPerProject-FreeTier", quotaValue: "50" },
          ],
        },
      ],
    },
  });
  assert.equal(parseQuotaFailure(body)?.perModelOnly, false);
});

test("garbage does not throw inside an error handler", () => {
  // This runs while already handling a failure; throwing here would replace a
  // useful 429 message with a 500.
  assert.equal(parseQuotaFailure(""), null);
  assert.equal(parseQuotaFailure("<html>502 Bad Gateway</html>"), null);
  assert.equal(parseQuotaFailure("{}"), null);
  assert.equal(parseQuotaFailure('{"error":{"details":"not an array"}}'), null);
  assert.equal(parseQuotaFailure('{"error":{"details":[null,3,"x"]}}'), null);
  assert.equal(quotaMessage(null).length > 0, true);
});

test("a body with only a retry delay still yields the delay", () => {
  const body = JSON.stringify({
    error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "7s" }] },
  });
  const f = parseQuotaFailure(body);
  assert.ok(f);
  assert.equal(f.retryDelaySeconds, 7);
  assert.equal(f.perModelOnly, false, "no violations means no basis to try another model");
});

test("an unparseable duration is dropped rather than guessed at", () => {
  const body = JSON.stringify({
    error: {
      details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "soon" }],
    },
  });
  assert.equal(parseQuotaFailure(body), null);
});

test("the log line names the quota, its value and the model", () => {
  const line = describeQuota(parseQuotaFailure(PER_MINUTE)!);
  assert.match(line, /GenerateRequestsPerMinutePerProjectPerModel/);
  assert.match(line, /limit=15/);
  assert.match(line, /model=gemini-3\.5-flash-lite/);
  assert.match(line, /retryDelay=31s/);
});
