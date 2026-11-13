import test from "node:test";
import assert from "node:assert/strict";
import {
  MeteoraClient,
  QUOTE_MINTS,
  SOL_MINT,
  USDC_MINT,
  resolveQuoteMint,
} from "../src/meteora/pools.js";

function pool(overrides = {}) {
  return {
    address: "pool-a",
    pool_type: "dlmm",
    token_x: { address: "mint-1" },
    token_y: { address: SOL_MINT },
    is_blacklisted: false,
    tvl: 10_000,
    active_tvl: 8_000,
    volume: 5_000,
    fee_active_tvl_ratio: 0.1,
    dlmm_params: { bin_step: 10 },
    volatility: 0.02,
    pool_price: 0.001,
    ...overrides,
  };
}

function clientWith(pools, { now = () => 1_000_000, quoteMint } = {}) {
  let calls = 0;
  const client = new MeteoraClient({
    now,
    quoteMint,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ data: pools }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { client, calls: () => calls };
}

test("selects the best exact-mint SOL DLMM pool", async () => {
  const { client } = clientWith([
    pool({ address: "pool-a", fee_active_tvl_ratio: 0.1 }),
    pool({ address: "pool-b", fee_active_tvl_ratio: 0.2, active_tvl: 5_000 }),
    pool({
      address: "pool-c",
      token_x: { address: SOL_MINT },
      token_y: { address: "mint-1" },
      fee_active_tvl_ratio: 0.15,
    }),
    pool({
      address: "pool-d",
      token_x: { address: "other" },
      token_y: { address: SOL_MINT },
      fee_active_tvl_ratio: 0.9,
    }),
    pool({ address: "pool-e", pool_type: "damn", fee_active_tvl_ratio: 0.8 }),
  ]);

  const best = await client.getBestPool("mint-1", {
    min_tvl: 5_000,
    min_active_tvl: 1_000,
    min_fee_active_tvl_ratio: 0.05,
    min_bin_step: 5,
    max_bin_step: 20,
  });

  assert.equal(best.address, "pool-b");
  assert.equal(best.url, "https://app.meteora.ag/dlmm/pool-b");
});

test("normalizes current Data API fields (windowed volume, fee ratio, pool_config)", async () => {
  const { client } = clientWith([
    {
      address: "live-pool",
      token_x: { address: "mint-1" },
      token_y: { address: SOL_MINT },
      is_blacklisted: false,
      tvl: 12_000,
      volume: { "30m": 100, "1h": 500, "24h": 5_000 },
      fee_tvl_ratio: { "30m": 1.5, "1h": 4.2, "24h": 16.95 },
      current_price: 0.001,
      pool_config: { bin_step: 100 },
    },
  ]);

  const best = await client.getBestPool("mint-1", {
    min_volume: 4_000,
    min_fee_active_tvl_ratio: 0.1,
    min_bin_step: 50,
    max_bin_step: 200,
  });

  assert.equal(best.address, "live-pool");
  assert.equal(best.volume, 5_000);
  assert.ok(Math.abs(best.feeActiveTvlRatio - 0.1695) < 1e-9);
  assert.equal(best.binStep, 100);
  assert.equal(best.poolPrice, 0.001);
});

test("falls back to TVL when fee and active TVL metrics are missing", async () => {
  const { client } = clientWith([
    pool({
      address: "small-pool",
      tvl: 1_000,
      active_tvl: undefined,
      fee_active_tvl_ratio: undefined,
    }),
    pool({
      address: "large-pool",
      tvl: 5_000,
      active_tvl: undefined,
      fee_active_tvl_ratio: undefined,
    }),
  ]);

  const best = await client.getBestPool("mint-1", {});
  assert.equal(best.address, "large-pool");
});

test("returns null when no pool passes filters", async () => {
  const { client } = clientWith([pool({ fee_active_tvl_ratio: 0.01 })]);
  const best = await client.getBestPool("mint-1", {
    min_fee_active_tvl_ratio: 0.05,
  });
  assert.equal(best, null);
});

test("caches pool lookups by mint", async () => {
  const { client, calls } = clientWith([pool()]);
  await client.getBestPool("mint-1", {});
  await client.getBestPool("mint-1", {});
  assert.equal(calls(), 1);
});

test("does not cache failed lookups", async () => {
  let calls = 0;
  const client = new MeteoraClient({
    fetchImpl: async () => {
      calls += 1;
      throw new Error("network down");
    },
  });
  await assert.rejects(() => client.getBestPool("mint-1", {}));
  await assert.rejects(() => client.getBestPool("mint-1", {}));
  assert.equal(calls, 2);
});

test("resolves quote symbols and raw mint addresses", () => {
  assert.equal(resolveQuoteMint("SOL"), SOL_MINT);
  assert.equal(resolveQuoteMint("usdc"), USDC_MINT);
  assert.equal(resolveQuoteMint("USDT"), QUOTE_MINTS.USDT);
  assert.equal(resolveQuoteMint("mint-custom"), "mint-custom");
  assert.equal(resolveQuoteMint(""), null);
  assert.equal(resolveQuoteMint(null), null);
});

test("selects pools for the configured quote symbol", async () => {
  const { client } = clientWith(
    [
      pool({ address: "sol-pool", fee_active_tvl_ratio: 0.9 }),
      pool({
        address: "usdc-pool",
        token_x: { address: USDC_MINT },
        token_y: { address: "mint-1" },
        fee_active_tvl_ratio: 0.2,
      }),
    ],
    { quoteMint: "USDC" },
  );

  const best = await client.getBestPool("mint-1", {});
  assert.equal(best.address, "usdc-pool");
  assert.equal(best.quoteMint, USDC_MINT);
});
