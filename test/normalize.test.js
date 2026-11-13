import test from "node:test";
import assert from "node:assert/strict";
import {
  boolOrNull,
  normalizeToken,
  normalizeRows,
  numberOrNull,
  parseDurationSec,
  scoreToken,
} from "../src/gmgn/normalize.js";

const NOW = 1_793_790_000_000;

function sampleRow(overrides = {}) {
  return {
    address: "mint-1",
    symbol: "TEST",
    name: "Test Token",
    creation_timestamp: 1_793_789_700,
    open_timestamp: 0,
    price: 0.001,
    price_change_percent1m: 1.5,
    price_change_percent5m: 4.2,
    price_change_percent1h: -2.1,
    market_cap: 100_000,
    history_highest_market_cap: 200_000,
    liquidity: 50_000,
    volume: 50_000,
    swaps: 100,
    buys: 10,
    sells: 5,
    holder_count: 100,
    visiting_count: 150,
    smart_degen_count: 2,
    renowned_count: 1,
    bot_degen_count: 20,
    rat_trader_amount_rate: 0.01,
    bundler_rate: 0.2,
    entrapment_ratio: 0.03,
    top_10_holder_rate: 0.25,
    top70_sniper_hold_rate: 0.05,
    dev_team_hold_rate: 0.04,
    sniper_count: 3,
    gas_fee: 2.5,
    rug_ratio: 0.01,
    buy_tax: "",
    sell_tax: "",
    is_honeypot: 0,
    is_wash_trading: false,
    renounced_mint: 1,
    renounced_freeze_account: 1,
    twitter_username: "test",
    ...overrides,
  };
}

test("parseDurationSec parses supported units", () => {
  assert.equal(parseDurationSec("5m"), 300);
  assert.equal(parseDurationSec("1h"), 3600);
  assert.equal(parseDurationSec("2d"), 172800);
  assert.equal(parseDurationSec("1w"), 604800);
  assert.equal(parseDurationSec(90), 90);
  assert.equal(parseDurationSec("bad"), null);
});

test("numberOrNull and boolOrNull coerce API values", () => {
  assert.equal(numberOrNull("12.5"), 12.5);
  assert.equal(numberOrNull(""), null);
  assert.equal(numberOrNull("nope"), null);
  assert.equal(boolOrNull(1), true);
  assert.equal(boolOrNull("0"), false);
  assert.equal(boolOrNull(undefined), null);
});

test("normalizeToken maps GMGN fields and derived ratios", () => {
  const token = normalizeToken(sampleRow(), { now: NOW });

  assert.equal(token.address, "mint-1");
  assert.equal(token.symbol, "TEST");
  assert.equal(token.visitingCount, 150);
  assert.equal(token.ageSec, 300);
  assert.equal(token.buyTax, null);
  assert.equal(token.sellTax, null);
  assert.equal(token.isHoneypot, false);
  assert.equal(token.isWashTrading, false);
  assert.equal(token.renouncedMint, true);
  assert.equal(token.renouncedFreeze, true);
  assert.equal(token.volumeLiquidityRatio, 1);
  assert.equal(token.buySellRatio, 2);
  assert.equal(token.priceVsAth, 0.5);
  assert.equal(token.hasSocial, true);
  assert.ok(token.score >= 0 && token.score <= 100);
});

test("normalizeToken uses open timestamp when creation is missing", () => {
  const token = normalizeToken(
    sampleRow({ creation_timestamp: 0, open_timestamp: 1_793_789_400 }),
    { now: NOW },
  );
  assert.equal(token.createdAt, 1_793_789_400);
  assert.equal(token.ageSec, 600);
});

test("normalizeToken returns null without address and normalizeRows filters it", () => {
  assert.equal(normalizeToken({ symbol: "NOPE" }, { now: NOW }), null);
  assert.deepEqual(normalizeRows([sampleRow(), { symbol: "NOPE" }], { now: NOW }).length, 1);
});

test("scoreToken stays in range and penalizes unsafe flags", () => {
  const safe = scoreToken({ visitingCount: 500, volume: 100_000, holderCount: 500, top10HolderRate: 0.1 });
  const unsafe = scoreToken({
    visitingCount: 500,
    volume: 100_000,
    holderCount: 500,
    top10HolderRate: 0.9,
    isHoneypot: true,
  });
  assert.ok(safe >= 0 && safe <= 100);
  assert.ok(unsafe >= 0 && unsafe <= 100);
  assert.ok(unsafe < safe);
});
