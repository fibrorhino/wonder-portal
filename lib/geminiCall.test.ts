// The fallback chain, against a scripted fetch. Nothing here reaches Google.
//
// The 429 body is the shape Google actually sends (see geminiQuota.test.ts for
// the captured original); what matters to this module is only whether the
// quota it names is scoped to one model.

import test from "node:test";
import assert from "node:assert/strict";
import { callGemini, geminiModelChain, geminiText, DEFAULT_GEMINI_MODELS } from "./geminiCall";

const quotaBody = (quotaId: string) =>
  JSON.stringify({
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [{ quotaId, quotaValue: "15", quotaDimensions: { model: "m" } }],
        },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "31s" },
      ],
    },
  });

const OK_BODY = JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] });

/** A fetch that answers from a script, per model, and records what was asked. */
function scripted(script: Record<string, { status: number; body: string }[]>) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const model = /models\/([^:]+):/.exec(String(url))![1];
    calls.push(model);
    const next = script[model]?.shift();
    if (!next) throw new Error(`no scripted response left for ${model}`);
    return new Response(next.body, { status: next.status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const base = {
  key: "SECRET-KEY",
  body: "{}",
  timeoutMs: 1000,
  tag: "test",
  sleep: async () => undefined,
  warn: () => undefined,
};

test("the override leads the chain and is not tried twice", () => {
  assert.deepEqual(geminiModelChain(undefined), DEFAULT_GEMINI_MODELS);
  assert.deepEqual(geminiModelChain("  "), DEFAULT_GEMINI_MODELS);
  assert.deepEqual(geminiModelChain("custom-model"), ["custom-model", ...DEFAULT_GEMINI_MODELS]);
  const second = DEFAULT_GEMINI_MODELS[1];
  const chain = geminiModelChain(second);
  assert.equal(chain[0], second);
  assert.equal(chain.filter((m) => m === second).length, 1);
});

test("a retired model id (404) falls through to the next", async () => {
  const { calls, fetchImpl } = scripted({
    a: [{ status: 404, body: "not found" }],
    b: [{ status: 200, body: OK_BODY }],
  });
  const r = await callGemini({ ...base, models: ["a", "b"], fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.model, "b");
  assert.deepEqual(calls, ["a", "b"], "a 404 is not retried");
  assert.equal(r.ok && geminiText(r.data), '{"a":1}');
});

test("a per-model 429 tries the next model; a project-wide one stops", async () => {
  const perModel = scripted({
    a: [{ status: 429, body: quotaBody("GenerateRequestsPerMinutePerProjectPerModel-FreeTier") }],
    b: [{ status: 200, body: OK_BODY }],
  });
  const r1 = await callGemini({ ...base, models: ["a", "b"], fetchImpl: perModel.fetchImpl });
  assert.equal(r1.ok, true);
  assert.deepEqual(perModel.calls, ["a", "b"]);

  const projectWide = scripted({
    a: [{ status: 429, body: quotaBody("GenerateRequestsPerDayPerProject-FreeTier") }],
    b: [{ status: 200, body: OK_BODY }],
  });
  const r2 = await callGemini({ ...base, models: ["a", "b"], fetchImpl: projectWide.fetchImpl });
  assert.equal(r2.ok, false);
  assert.deepEqual(projectWide.calls, ["a"], "another model would hit the same wall");
  assert.equal(!r2.ok && r2.status, 429);
  assert.equal(!r2.ok && r2.quota?.daily, true);
  assert.equal(!r2.ok && r2.quota?.retryDelaySeconds, 31);
});

test("a 429 that does not say which quota is not assumed to be per-model", async () => {
  const { calls, fetchImpl } = scripted({
    a: [{ status: 429, body: "slow down" }],
    b: [{ status: 200, body: OK_BODY }],
  });
  const r = await callGemini({ ...base, models: ["a", "b"], fetchImpl });
  assert.equal(r.ok, false);
  assert.deepEqual(calls, ["a"]);
});

test("503 is retried three times, then the next model is tried", async () => {
  const busy = { status: 503, body: "overloaded" };
  const { calls, fetchImpl } = scripted({
    a: [busy, busy, busy],
    b: [busy, { status: 200, body: OK_BODY }],
  });
  const r = await callGemini({ ...base, models: ["a", "b"], fetchImpl });
  assert.equal(r.ok, true);
  assert.deepEqual(calls, ["a", "a", "a", "b", "b"]);
});

test("when every model fails, the last failure is what is reported", async () => {
  const { fetchImpl } = scripted({
    a: [{ status: 404, body: "gone" }],
    b: [{ status: 404, body: "also gone" }],
  });
  const r = await callGemini({ ...base, models: ["a", "b"], fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.status, 404);
  assert.equal(!r.ok && r.model, "b");
  assert.equal(!r.ok && r.detail, "also gone");
});

test("a bad key (400/403) stops at once: another model will not fix it", async () => {
  const { calls, fetchImpl } = scripted({
    a: [{ status: 400, body: "API key not valid" }],
    b: [{ status: 200, body: OK_BODY }],
  });
  const r = await callGemini({ ...base, models: ["a", "b"], fetchImpl });
  assert.equal(r.ok, false);
  assert.deepEqual(calls, ["a"]);
});

test("a network failure is reported without the API key in it", async () => {
  const fetchImpl = (async (url: string | URL | Request) => {
    // undici puts the request URL, key and all, into some of its messages.
    throw new Error(`fetch failed for ${String(url)}`);
  }) as typeof fetch;
  const r = await callGemini({ ...base, models: ["a"], fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.status, null);
  assert.ok(!r.ok && !r.detail.includes("SECRET-KEY"), !r.ok ? r.detail : "");
});

test("geminiText tolerates every shape of empty", () => {
  for (const data of [null, undefined, {}, { candidates: [] }, { candidates: [{}] }, "text"]) {
    assert.equal(geminiText(data), null);
  }
});
