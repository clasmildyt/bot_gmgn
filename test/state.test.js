import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/state/store.js";

function token(overrides = {}) {
  return {
    address: "mint-1",
    symbol: "TEST",
    name: "Test",
    price: 0.001,
    marketCap: 100_000,
    liquidity: 50_000,
    volume: 60_000,
    swaps: 100,
    holderCount: 100,
    visitingCount: 150,
    score: 70,
    ageSec: 600,
    top10HolderRate: 0.2,
    bundlerRate: 0.1,
    insiderRate: 0.01,
    devTeamHoldRate: 0.02,
    isHoneypot: false,
    isWashTrading: false,
    renouncedMint: true,
    renouncedFreeze: true,
    ...overrides,
  };
}

test("tracks first alert and repeat interval", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bot-gmgn-state-"));
  try {
    let now = Date.parse("2026-01-01T00:00:00Z");
    const store = new StateStore({ path: path.join(dir, "state.json"), now: () => now });
    await store.load();

    assert.equal(store.shouldAlert(token(), 300), true);
    store.markSent(token(), { repeatCount: 0 });
    assert.equal(store.shouldAlert(token(), 300), false);

    now += 299_000;
    assert.equal(store.shouldAlert(token(), 300), false);
    now += 1_000;
    assert.equal(store.shouldAlert(token(), 300), true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("saves and reloads state atomically", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bot-gmgn-state-"));
  try {
    const statePath = path.join(dir, "nested", "state.json");
    const now = Date.parse("2026-01-01T00:00:00Z");
    const store = new StateStore({ path: statePath, now: () => now });
    await store.load();
    store.markSeen(token(), { passing: true });
    store.markSent(token(), { repeatCount: 2 });
    await store.save();

    const reloaded = new StateStore({ path: statePath, now: () => now });
    await reloaded.load();
    const entry = reloaded.get("mint-1");
    assert.equal(entry.repeatCount, 2);
    assert.equal(entry.passing, true);
    assert.equal(entry.lastSnapshot.visitingCount, 150);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("prunes entries older than retention", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bot-gmgn-state-"));
  try {
    let now = 1_000_000;
    const store = new StateStore({ path: path.join(dir, "state.json"), now: () => now });
    await store.load();
    store.markSeen(token(), { passing: true });
    now += 2_000;
    store.prune(1);
    assert.equal(store.get("mint-1"), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
