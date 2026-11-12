// One-at-a-time, spaced-out execution for calls to CDC WONDER.
//
// CDC requires at least fifteen seconds between requests and answers anything
// faster with a 429, so every outbound call is serialised through a single
// promise chain: each waits for the one before it to finish, then for the gap
// since the last one STARTED.
//
// The chain used to be unbounded. Nothing in front of it stops a tenth visitor
// joining a queue that is already two minutes long, and the tunnel this site
// sits behind gives up on a request at 100 seconds, so that visitor saw a
// gateway error while their call stayed queued and went out to CDC anyway, for
// nobody. A call that cannot start within `maxWaitMs` is now refused at once,
// which the route turns into "busy, try again shortly".

export class QueueFullError extends Error {
  constructor(public readonly estimatedWaitMs: number) {
    super("Too many CDC WONDER requests are already waiting.");
    this.name = "QueueFullError";
  }
}

export interface Throttle {
  /** Run `fn` when its turn comes. Rejects with QueueFullError if the wait is too long. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** Calls waiting or running. */
  readonly pending: number;
}

export function createThrottle(options: {
  minGapMs: number;
  /** Longest a call may wait for its turn before being refused instead. */
  maxWaitMs: number;
  /** Test seams. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Throttle {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastStartAt = Number.NEGATIVE_INFINITY;
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;

  return {
    get pending() {
      return pending;
    },
    run<T>(fn: () => Promise<T>): Promise<T> {
      // Every call ahead of this one costs at least one gap. That is a floor,
      // not a forecast (a slow response costs more), so the bound errs towards
      // letting a call through.
      const untilFree = Math.max(0, lastStartAt + options.minGapMs - now());
      const estimatedWaitMs = pending === 0 ? untilFree : pending * options.minGapMs;
      if (estimatedWaitMs > options.maxWaitMs) {
        return Promise.reject(new QueueFullError(estimatedWaitMs));
      }

      pending++;
      const result = queue.then(async () => {
        const wait = lastStartAt + options.minGapMs - now();
        if (wait > 0) await sleep(wait);
        lastStartAt = now();
        return fn();
      });
      // The chain must survive a failed call, and the count must come down
      // whether the call succeeded or not.
      queue = result.then(
        () => undefined,
        () => undefined,
      ).then(() => {
        pending--;
      });
      return result;
    },
  };
}
