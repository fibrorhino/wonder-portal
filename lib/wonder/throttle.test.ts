// The spacing CDC requires, and the bound that keeps the queue from growing
// past what the tunnel will wait for. Driven by a fake clock: the real gap is
// fifteen seconds and nothing here should take that long.

import test from "node:test";
import assert from "node:assert/strict";
import { createThrottle, QueueFullError } from "./throttle";

function fakeClock() {
  let t = 1_000_000;
  return {
    now: () => t,
    // Sleeping advances the clock instead of waiting.
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

test("calls start at least the minimum gap apart, in order", async () => {
  const clock = fakeClock();
  const throttle = createThrottle({ minGapMs: 15_500, maxWaitMs: 60_000, ...clock });
  const starts: { id: number; at: number }[] = [];
  const call = (id: number) =>
    throttle.run(async () => {
      starts.push({ id, at: clock.now() });
      clock.advance(3_000); // each "request" takes three seconds
      return id;
    });

  const results = await Promise.all([call(1), call(2), call(3)]);
  assert.deepEqual(results, [1, 2, 3]);
  assert.deepEqual(starts.map((s) => s.id), [1, 2, 3]);
  assert.equal(starts[1].at - starts[0].at, 15_500);
  assert.equal(starts[2].at - starts[1].at, 15_500);
});

test("the first call, and one after a long quiet spell, does not wait", async () => {
  const clock = fakeClock();
  const throttle = createThrottle({ minGapMs: 15_500, maxWaitMs: 60_000, ...clock });
  const t0 = clock.now();
  await throttle.run(async () => undefined);
  assert.equal(clock.now(), t0, "nothing to wait for on the first call");
  clock.advance(60_000);
  const t1 = clock.now();
  await throttle.run(async () => undefined);
  assert.equal(clock.now(), t1);
});

test("a failed call does not jam the queue or leak a pending slot", async () => {
  const clock = fakeClock();
  const throttle = createThrottle({ minGapMs: 15_500, maxWaitMs: 60_000, ...clock });
  await assert.rejects(
    throttle.run(async () => {
      throw new Error("CDC said no");
    }),
    /CDC said no/,
  );
  assert.equal(await throttle.run(async () => "next"), "next");
  await Promise.resolve();
  assert.equal(throttle.pending, 0);
});

test("a call that could not start in time is refused instead of queued", async () => {
  const clock = fakeClock();
  const throttle = createThrottle({ minGapMs: 15_500, maxWaitMs: 60_000, ...clock });
  let ran = 0;
  // Never resolved until released, so the queue genuinely backs up.
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const calls = [];
  for (let i = 0; i < 4; i++) {
    calls.push(
      throttle.run(async () => {
        ran++;
        await gate;
      }),
    );
  }
  assert.equal(throttle.pending, 4);
  // Four ahead is 62 s of gaps at the very least: past the 60 s bound.
  await assert.rejects(
    throttle.run(async () => {
      ran++;
    }),
    (e: unknown) => e instanceof QueueFullError && e.estimatedWaitMs === 62_000,
  );
  release();
  await Promise.all(calls);
  assert.equal(ran, 4, "the refused call never ran");
});
