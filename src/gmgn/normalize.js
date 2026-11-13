export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function boolOrNull(value) {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = numberOrNull(value);
    if (number !== null) return number;
  }
  return null;
}

export function parseDurationSec(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const match = /^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)$/i.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[unit];
  return amount * multiplier;
}

export function scoreToken(token) {
  let score = 0;
  score += clamp(Math.log10((token.visitingCount ?? 0) + 1) * 12, 0, 30);
  score += clamp(Math.log10((token.volume ?? 0) + 1) * 4, 0, 20);
  score += clamp(Math.log10((token.holderCount ?? 0) + 1) * 5, 0, 15);
  score += clamp((token.smartDegenCount ?? 0) * 2 + (token.renownedCount ?? 0) * 2, 0, 15);
  score += clamp((token.volumeLiquidityRatio ?? 0) * 5, 0, 10);
  score += clamp((token.buySellRatio ?? 1) * 2, 0, 10);
  score -= clamp((token.top10HolderRate ?? 0) * 20, 0, 10);
  score -= clamp((token.bundlerRate ?? 0) * 10, 0, 10);
  score -= clamp((token.insiderRate ?? 0) * 20, 0, 10);
  if (token.isHoneypot) score -= 50;
  if (token.isWashTrading) score -= 20;
  return Math.round(clamp(score, 0, 100));
}

export function normalizeToken(row, { now = Date.now() } = {}) {
  if (!row || typeof row !== "object") return null;

  const address = row.address ?? row.token_address ?? row.mint;
  if (!address) return null;

  const symbol = row.symbol ?? row.trans_symbol ?? "?";
  const name = row.name ?? row.trans_name ?? symbol;
  const creationTimestamp = numberOrNull(row.creation_timestamp);
  const openTimestamp = numberOrNull(row.open_timestamp);
  const createdAt =
    creationTimestamp && creationTimestamp > 0
      ? creationTimestamp
      : openTimestamp && openTimestamp > 0
        ? openTimestamp
        : null;

  const nowSec = Math.floor(now / 1000);
  const ageSec = createdAt !== null ? Math.max(0, nowSec - createdAt) : null;

  const marketCap = firstNumber(row.market_cap, row.marketcap, row.mc);
  const athMarketCap = firstNumber(
    row.history_highest_market_cap,
    row.history_highest_marketcap,
    row.ath_market_cap,
  );
  const liquidity = firstNumber(row.liquidity, row.liquidity_usd);
  const volume = firstNumber(row.volume, row.volume_usd);
  const buys = firstNumber(row.buys, row.buy_count);
  const sells = firstNumber(row.sells, row.sell_count);
  const holderCount = firstNumber(row.holder_count, row.holders);
  const visitingCount = firstNumber(row.visiting_count, row.visitors);

  const token = {
    address,
    symbol,
    name,
    chain: row.chain ?? null,
    price: firstNumber(row.price, row.price_usd),
    priceChangePercent: firstNumber(row.price_change_percent),
    priceChange1m: firstNumber(row.price_change_percent1m, row.price_change_percent_1m),
    priceChange5m: firstNumber(row.price_change_percent5m, row.price_change_percent_5m),
    priceChange1h: firstNumber(row.price_change_percent1h, row.price_change_percent_1h),
    volume,
    liquidity,
    marketCap,
    athMarketCap,
    totalSupply: firstNumber(row.total_supply),
    initialLiquidity: firstNumber(row.initial_liquidity),
    swaps: firstNumber(row.swaps, row.tx_count),
    buys,
    sells,
    holderCount,
    visitingCount,
    smartDegenCount: firstNumber(row.smart_degen_count, row.smart_degen),
    renownedCount: firstNumber(row.renowned_count, row.renowned),
    botDegenCount: firstNumber(row.bot_degen_count, row.bot_degen),
    botDegenRate: firstNumber(row.bot_degen_rate),
    insiderRate: firstNumber(row.rat_trader_amount_rate, row.insider_rate),
    bundlerRate: firstNumber(row.bundler_rate),
    entrapmentRatio: firstNumber(row.entrapment_ratio),
    top10HolderRate: firstNumber(row.top_10_holder_rate, row.top10_holder_rate),
    top70SniperHoldRate: firstNumber(row.top70_sniper_hold_rate),
    devTeamHoldRate: firstNumber(row.dev_team_hold_rate),
    sniperCount: firstNumber(row.sniper_count),
    gasFee: firstNumber(row.gas_fee, row.total_fee),
    rugRatio: firstNumber(row.rug_ratio),
    buyTax: numberOrNull(row.buy_tax),
    sellTax: numberOrNull(row.sell_tax),
    lockPercent: numberOrNull(row.lock_percent),
    burnStatus: row.burn_status ?? null,
    launchpad: row.launchpad_platform ?? row.launchpad ?? null,
    exchange: row.exchange ?? null,
    isHoneypot: boolOrNull(row.is_honeypot),
    isWashTrading: boolOrNull(row.is_wash_trading),
    renouncedMint: boolOrNull(row.renounced_mint),
    renouncedFreeze: boolOrNull(row.renounced_freeze_account),
    createdAt,
    ageSec,
    hasSocial: Boolean(
      row.twitter_username || row.website || row.telegram || row.twitter || row.website_url,
    ),
    twitter: row.twitter_username ?? row.twitter ?? null,
    website: row.website ?? row.website_url ?? null,
    telegram: row.telegram ?? null,
  };

  token.volumeLiquidityRatio =
    token.volume !== null && token.liquidity !== null && token.liquidity > 0
      ? token.volume / token.liquidity
      : null;
  token.buySellRatio =
    token.buys !== null && token.sells !== null
      ? token.buys / Math.max(token.sells, 1)
      : null;
  token.priceVsAth =
    token.marketCap !== null && token.athMarketCap !== null && token.athMarketCap > 0
      ? token.marketCap / token.athMarketCap
      : null;
  token.score = scoreToken(token);

  return token;
}

export function normalizeRows(rows, options = {}) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => normalizeToken(row, options)).filter(Boolean);
}
