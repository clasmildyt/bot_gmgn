import test from "node:test";
import assert from "node:assert/strict";
import { ConfigSchema } from "../src/config.js";
import { evaluateToken, evaluateTokens } from "../src/filters/engine.js";

function baseConfig(overrides = {}) {
  return ConfigSchema.parse({
    filters: {
      server: {
        min_visiting_count: 100,
        min_volume: 50_000,
        ...(overrides.server ?? {}),
      },
      client: {
        reject_honeypot: true,
        reject_wash_trading: true,
        require_mint_renounced: true,
        require_freeze_renounced: true,
        max_buy_tax: 0.1,
        max_sell_tax: 0.1,
        ...(overrides.client ?? {}),
      },
    },
    ...(overrides.scoring ? { scoring: overrides.scoring } : {}),
  });
}

function token(overrides = {}) {
  return {
    address: "mint-1",
    symbol: "TEST",
    name: "Test",
    visitingCount: 150,
    volume: 60_000,
    liquidity: 30_000,
    marketCap: 100_000,
    holderCount: 100,
    swaps: 50,
    ageSec: 600,
    volumeLiquidityRatio: 2,
    buySellRatio: 1.5,
    priceChange1m: 1,
    priceChange5m: 2,
    priceChange1h: 3,
    priceVsAth: 0.5,
    top10HolderRate: 0.2,
    bundlerRate: 0.1,
    insiderRate: 0.01,
    devTeamHoldRate: 0.02,
    buyTax: null,
    sellTax: null,
    isHoneypot: false,
    isWashTrading: false,
    renouncedMint: true,
    renouncedFreeze: true,
    hasSocial: true,
    score: 70,
    ...overrides,
  };
}

test("passes with confirmed filters and safe token", () => {
  const result = evaluateToken(token(), baseConfig());
  assert.equal(result.pass, true);
  assert.deepEqual(result.reasons, []);
});

test("rejects when visiting_count or volume is below the server filter", () => {
  const lowVisiting = evaluateToken(token({ visitingCount: 99 }), baseConfig());
  const lowVolume = evaluateToken(token({ volume: 49_999 }), baseConfig());
  assert.equal(lowVisiting.pass, false);
  assert.match(lowVisiting.reasons.join(";"), /visitingCount/);
  assert.equal(lowVolume.pass, false);
  assert.match(lowVolume.reasons.join(";"), /volume/);
});

test("rejects unknown or unsafe security fields", () => {
  const honeypot = evaluateToken(token({ isHoneypot: null }), baseConfig());
  const wash = evaluateToken(token({ isWashTrading: true }), baseConfig());
  const mint = evaluateToken(token({ renouncedMint: false }), baseConfig());
  const freeze = evaluateToken(token({ renouncedFreeze: null }), baseConfig());
  assert.equal(honeypot.pass, false);
  assert.equal(wash.pass, false);
  assert.equal(mint.pass, false);
  assert.equal(freeze.pass, false);
});

test("rejects taxes above configured limits", () => {
  const result = evaluateToken(token({ buyTax: 0.2, sellTax: 0.3 }), baseConfig());
  assert.equal(result.pass, false);
  assert.match(result.reasons.join(";"), /buy tax/);
  assert.match(result.reasons.join(";"), /sell tax/);
});

test("supports min_created and client age filters", () => {
  const config = baseConfig({ server: { min_created: "5m" } });
  assert.equal(evaluateToken(token({ ageSec: 300 }), config).pass, true);
  assert.equal(evaluateToken(token({ ageSec: 299 }), config).pass, false);

  const clientAge = baseConfig({ client: { max_age_sec: 3600 } });
  assert.equal(evaluateToken(token({ ageSec: 3600 }), clientAge).pass, true);
  assert.equal(evaluateToken(token({ ageSec: 3601 }), clientAge).pass, false);
});

test("supports ratio and price-change client filters", () => {
  const config = baseConfig({
    client: {
      min_volume_liquidity_ratio: 1,
      max_buy_sell_ratio: 2,
      min_price_change_1h: 0,
    },
  });
  assert.equal(evaluateToken(token(), config).pass, true);
  assert.equal(evaluateToken(token({ volumeLiquidityRatio: 0.5 }), config).pass, false);
  assert.equal(evaluateToken(token({ buySellRatio: 3 }), config).pass, false);
  assert.equal(evaluateToken(token({ priceChange1h: -1 }), config).pass, false);
});

test("scoring can be enabled as a filter", () => {
  const config = baseConfig({ scoring: { enabled: true, min_score: 60 } });
  assert.equal(evaluateToken(token({ score: 60 }), config).pass, true);
  const result = evaluateToken(token({ score: 59 }), config);
  assert.equal(result.pass, false);
  assert.match(result.reasons.join(";"), /score/);
});

test("evaluateTokens sorts passing tokens by score then volume", () => {
  const config = baseConfig();
  const result = evaluateTokens(
    [
      token({ address: "a", symbol: "A", score: 50, volume: 60_000 }),
      token({ address: "b", symbol: "B", score: 80, volume: 60_000 }),
      token({ address: "c", symbol: "C", score: 50, volume: 70_000 }),
    ],
    config,
  );
  assert.deepEqual(result.passed.map((item) => item.address), ["b", "c", "a"]);
});
