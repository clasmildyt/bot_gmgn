import test from "node:test";
import assert from "node:assert/strict";
import { MinIntervalLimiter } from "../src/gmgn/rate-limiter.js";

test("waits for the next allowed slot", async () => {
  let now = 0;
  const sleeps = [];
  const limiter = new MinIntervalLimiter({
    minIntervalMs: 5000,
    jitterMs: 0,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  });

  await limiter.acquire();
  assert.deepEqual(sleeps, []);

  now += 1000;
  await limiter.acquire();
  assert.deepEqual(sleeps, [4000]);
});

test("penalize pushes the next slot forward", async () => {
  let now = 0;
  const sleeps = [];
  const limiter = new MinIntervalLimiter({
    minIntervalMs: 5000,
    jitterMs: 0,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  });

  await limiter.acquire();
  now += 1000;
  limiter.penalize(10_000);
  await limiter.acquire();
  assert.deepEqual(sleeps, [10_000]);
});
