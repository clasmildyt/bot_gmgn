import test from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  formatAge,
  formatAlert,
  formatBool,
  formatRate,
  formatUsd,
  truncateMessage,
} from "../src/report/format.js";

function token(overrides = {}) {
  return {
    address: "mint-1",
    symbol: "TEST",
    name: "Test Token",
    score: 72,
    visitingCount: 150,
    marketCap: 100_000,
    liquidity: 50_000,
    volume: 60_000,
    swaps: 100,
    buys: 60,
    sells: 40,
    holderCount: 100,
    ageSec: 600,
    price: 0.001,
    priceChange1m: 1.5,
    priceChange5m: 4.2,
    priceChange1h: -2.1,
    isHoneypot: false,
    isWashTrading: false,
    renouncedMint: true,
    renouncedFreeze: true,
    top10HolderRate: 0.25,
    bundlerRate: 0.2,
    insiderRate: 0.01,
    devTeamHoldRate: 0.04,
    ...overrides,
  };
}

const pool = {
  address: "pool-1",
  label: "DLMM pool-1",
  url: "https://app.meteora.ag/dlmm/pool-1",
  tvl: 10_000,
  activeTvl: 8_000,
  volume: 5_000,
  feeActiveTvlRatio: 0.1,
  binStep: 10,
};

test("formats USD, rates, age, and booleans", () => {
  assert.equal(formatUsd(1_500_000), "$1.50M");
  assert.equal(formatRate(0.2552), "25.52%");
  assert.equal(formatAge(600), "10m");
  assert.equal(formatAge(3_900), "1h5m");
  assert.equal(formatBool(true), "yes");
  assert.equal(formatBool(null), "n/a");
});

test("escapes HTML", () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
});

test("formats a complete alert with repeat marker and pool", () => {
  const text = formatAlert(token(), pool, { repeatCount: 2, interval: "5m" });
  assert.match(text, /TEST/);
  assert.match(text, /\[REPEAT #2\]/);
  assert.match(text, /Visiting: 150/);
  assert.match(text, /mint-1/);
  assert.match(text, /Meteora/);
  assert.match(text, /Score: 72\/100/);
  assert.doesNotMatch(text, /undefined/);
});

test("escapes token-controlled text in alert", () => {
  const text = formatAlert(
    token({ symbol: "<b>X</b>", name: "A & B", address: "mint<1>" }),
    null,
  );
  assert.match(text, /&lt;b&gt;X&lt;\/b&gt;/);
  assert.match(text, /A &amp; B/);
  assert.match(text, /mint&lt;1&gt;/);
});

test("uses the configured quote in the no-pool message", () => {
  const text = formatAlert(token(), null, { quote: "USDC" });
  assert.match(text, /no eligible USDC\/DLMM pool found/);
});

test("truncates long messages", () => {
  assert.equal(truncateMessage("abcdef", 5), "ab...");
  assert.equal(truncateMessage("abc", 5), "abc");
});
