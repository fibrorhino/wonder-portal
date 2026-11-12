import test from "node:test";
import assert from "node:assert/strict";
import { createCache, FINAL_TTL_MS, PROVISIONAL_TTL_MS } from "./cache";

test("an entry can outlive the cache's default lifetime", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const cache = createCache<string>({ ttlMs: 1000, maxEntries: 10 });
  cache.set("short", "provisional");
  cache.set("long", "final", 10_000);
  t.mock.timers.tick(1500);
  assert.equal(cache.get("short"), undefined, "default lifetime has passed");
  assert.equal(cache.get("long"), "final", "its own lifetime has not");
  t.mock.timers.tick(10_000);
  assert.equal(cache.get("long"), undefined);
});

test("re-setting a key does not push out a neighbour", () => {
  const cache = createCache<number>({ ttlMs: 60_000, maxEntries: 2 });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("b", 3); // the cache is full, but nothing new is being added
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("b"), 3);
  cache.set("c", 4); // now something is: the oldest goes
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.size, 2);
});

test("final data is kept longer than provisional data", () => {
  assert.ok(FINAL_TTL_MS > PROVISIONAL_TTL_MS);
  assert.equal(PROVISIONAL_TTL_MS, 12 * 60 * 60 * 1000, "the lifetime it always had");
});
