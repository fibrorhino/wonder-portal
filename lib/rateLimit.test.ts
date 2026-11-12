import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter, visitorKey, waitPhrase } from "./rateLimit";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test("requests are allowed up to the limit and refused after it", () => {
  const c = clock();
  const limiter = createRateLimiter([{ limit: 3, windowMs: 60_000 }], c);
  assert.deepEqual(limiter.take("a"), { ok: true });
  assert.deepEqual(limiter.take("a"), { ok: true });
  assert.deepEqual(limiter.take("a"), { ok: true });
  const refused = limiter.take("a");
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.retryAfterSeconds, 60);
});

test("one visitor's use does not count against another's", () => {
  const c = clock();
  const limiter = createRateLimiter([{ limit: 1, windowMs: 60_000 }], c);
  assert.equal(limiter.take("a").ok, true);
  assert.equal(limiter.take("a").ok, false);
  assert.equal(limiter.take("b").ok, true);
});

test("the window slides: waiting the stated time clears the refusal", () => {
  const c = clock();
  const limiter = createRateLimiter([{ limit: 2, windowMs: 60_000 }], c);
  limiter.take("a");
  c.advance(20_000);
  limiter.take("a");
  const refused = limiter.take("a");
  assert.equal(!refused.ok && refused.retryAfterSeconds, 40, "until the first request ages out");
  // Hammering while refused must not push the wait further out.
  for (let i = 0; i < 10; i++) limiter.take("a");
  c.advance(40_000);
  assert.equal(limiter.take("a").ok, true);
});

test("a short limit and a daily limit are both enforced", () => {
  const c = clock();
  const limiter = createRateLimiter(
    [
      { limit: 2, windowMs: 60_000 },
      { limit: 3, windowMs: 3_600_000 },
    ],
    c,
  );
  assert.equal(limiter.take("a").ok, true);
  assert.equal(limiter.take("a").ok, true);
  assert.equal(limiter.take("a").ok, false, "the per-minute rule");
  c.advance(61_000);
  assert.equal(limiter.take("a").ok, true);
  c.advance(61_000);
  const refused = limiter.take("a");
  assert.equal(refused.ok, false, "the hourly rule, though the minute is clear");
  assert.ok(!refused.ok && refused.retryAfterSeconds > 3000);
});

test("the table of visitors cannot grow without bound", () => {
  const c = clock();
  const limiter = createRateLimiter([{ limit: 1, windowMs: 60_000 }], { ...c, maxKeys: 3 });
  for (const key of ["a", "b", "c", "d"]) limiter.take(key);
  // "a" was the least recently seen and has been forgotten; "d" has not.
  assert.equal(limiter.take("a").ok, true);
  assert.equal(limiter.take("d").ok, false);
});

test("the visitor is identified by Cloudflare's header, then the forwarded one", () => {
  assert.equal(visitorKey(new Headers({ "cf-connecting-ip": " 203.0.113.9 " })), "203.0.113.9");
  assert.equal(
    visitorKey(new Headers({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" })),
    "198.51.100.4",
  );
  assert.equal(visitorKey(new Headers()), "unknown");
});

test("waits are described the way a person would say them", () => {
  assert.equal(waitPhrase(5), "about a minute");
  assert.equal(waitPhrase(240), "about 4 minutes");
  assert.equal(waitPhrase(3500), "about an hour");
  assert.equal(waitPhrase(3 * 3600), "about 3 hours");
});
