import { parseDurationSec } from "../gmgn/normalize.js";

const SERVER_FILTERS = {
  min_visiting_count: ["visitingCount", "min"],
  max_visiting_count: ["visitingCount", "max"],
  min_volume: ["volume", "min"],
  max_volume: ["volume", "max"],
  min_liquidity: ["liquidity", "min"],
  max_liquidity: ["liquidity", "max"],
  min_market_cap: ["marketCap", "min"],
  max_market_cap: ["marketCap", "max"],
  min_holder_count: ["holderCount", "min"],
  max_holder_count: ["holderCount", "max"],
  min_swaps: ["swaps", "min"],
  max_swaps: ["swaps", "max"],
  min_smart_degen_count: ["smartDegenCount", "min"],
  max_smart_degen_count: ["smartDegenCount", "max"],
  min_renowned_count: ["renownedCount", "min"],
  max_renowned_count: ["renownedCount", "max"],
  min_bot_degen_count: ["botDegenCount", "min"],
  max_bot_degen_count: ["botDegenCount", "max"],
  min_insider_rate: ["insiderRate", "min"],
  max_insider_rate: ["insiderRate", "max"],
  min_bundler_rate: ["bundlerRate", "min"],
  max_bundler_rate: ["bundlerRate", "max"],
  min_entrapment_ratio: ["entrapmentRatio", "min"],
  max_entrapment_ratio: ["entrapmentRatio", "max"],
  min_top10_holder_rate: ["top10HolderRate", "min"],
  max_top10_holder_rate: ["top10HolderRate", "max"],
  min_top70_sniper_hold_rate: ["top70SniperHoldRate", "min"],
  max_top70_sniper_hold_rate: ["top70SniperHoldRate", "max"],
  min_dev_team_hold_rate: ["devTeamHoldRate", "min"],
  max_dev_team_hold_rate: ["devTeamHoldRate", "max"],
  min_sniper_count: ["sniperCount", "min"],
  max_sniper_count: ["sniperCount", "max"],
  min_gas_fee: ["gasFee", "min"],
  max_gas_fee: ["gasFee", "max"],
  min_rug_ratio: ["rugRatio", "min"],
  max_rug_ratio: ["rugRatio", "max"],
};

const AGE_FILTERS = {
  min_created: "min",
  max_created: "max",
};

function checkRange(label, actual, min, max) {
  if (min !== null && min !== undefined) {
    if (actual === null || actual === undefined) return `${label} unknown`;
    if (actual < min) return `${label} ${actual} < ${min}`;
  }
  if (max !== null && max !== undefined) {
    if (actual === null || actual === undefined) return `${label} unknown`;
    if (actual > max) return `${label} ${actual} > ${max}`;
  }
  return null;
}

function checkServerFilter(token, key, value) {
  if (AGE_FILTERS[key]) {
    const limit = parseDurationSec(value);
    if (limit === null) return `${key} invalid`;
    if (token.ageSec === null) return `${key} unknown`;
    if (AGE_FILTERS[key] === "min" && token.ageSec < limit) {
      return `${key} age ${token.ageSec}s < ${limit}s`;
    }
    if (AGE_FILTERS[key] === "max" && token.ageSec > limit) {
      return `${key} age ${token.ageSec}s > ${limit}s`;
    }
    return null;
  }

  const mapping = SERVER_FILTERS[key];
  if (!mapping) return null;

  const [field, operator] = mapping;
  const limit = Number(value);
  if (!Number.isFinite(limit)) return `${key} invalid`;
  const actual = token[field];

  if (actual === null || actual === undefined) return `${field} unknown`;
  if (operator === "min" && actual < limit) return `${field} ${actual} < ${limit}`;
  if (operator === "max" && actual > limit) return `${field} ${actual} > ${limit}`;
  return null;
}

function checkClientFilters(token, filters) {
  const reasons = [];

  if (filters.reject_honeypot && token.isHoneypot !== false) {
    reasons.push("honeypot unknown or true");
  }
  if (filters.reject_wash_trading && token.isWashTrading !== false) {
    reasons.push("wash trading unknown or true");
  }
  if (filters.require_mint_renounced && token.renouncedMint !== true) {
    reasons.push("mint authority not renounced");
  }
  if (filters.require_freeze_renounced && token.renouncedFreeze !== true) {
    reasons.push("freeze authority not renounced");
  }

  if (filters.max_buy_tax !== null && token.buyTax !== null && token.buyTax > filters.max_buy_tax) {
    reasons.push(`buy tax ${token.buyTax} > ${filters.max_buy_tax}`);
  }
  if (filters.max_sell_tax !== null && token.sellTax !== null && token.sellTax > filters.max_sell_tax) {
    reasons.push(`sell tax ${token.sellTax} > ${filters.max_sell_tax}`);
  }

  for (const [label, actual, minKey, maxKey] of [
    ["volume/liquidity", token.volumeLiquidityRatio, "min_volume_liquidity_ratio", "max_volume_liquidity_ratio"],
    ["buy/sell", token.buySellRatio, "min_buy_sell_ratio", "max_buy_sell_ratio"],
    ["price change 1m", token.priceChange1m, "min_price_change_1m", "max_price_change_1m"],
    ["price change 5m", token.priceChange5m, "min_price_change_5m", "max_price_change_5m"],
    ["price change 1h", token.priceChange1h, "min_price_change_1h", "max_price_change_1h"],
    ["price vs ATH", token.priceVsAth, "min_price_vs_ath", "max_price_vs_ath"],
  ]) {
    const reason = checkRange(label, actual, filters[minKey], filters[maxKey]);
    if (reason) reasons.push(reason);
  }

  if (filters.require_social && !token.hasSocial) reasons.push("social links missing");

  const ageReason = checkRange("age", token.ageSec, filters.min_age_sec, filters.max_age_sec);
  if (ageReason) reasons.push(ageReason);

  return reasons;
}

export function evaluateToken(token, config, now = Date.now()) {
  const reasons = [];

  for (const [key, value] of Object.entries(config.filters.server ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    const reason = checkServerFilter(token, key, value);
    if (reason) reasons.push(reason);
  }

  reasons.push(...checkClientFilters(token, config.filters.client ?? {}));

  if (config.scoring?.enabled && token.score < config.scoring.min_score) {
    reasons.push(`score ${token.score} < ${config.scoring.min_score}`);
  }

  return { pass: reasons.length === 0, reasons };
}

export function evaluateTokens(tokens, config, now = Date.now()) {
  const passed = [];
  const rejected = [];

  for (const token of tokens) {
    const result = evaluateToken(token, config, now);
    if (result.pass) passed.push(token);
    else rejected.push({ token, reasons: result.reasons });
  }

  passed.sort(
    (a, b) =>
      b.score - a.score ||
      (b.volume ?? 0) - (a.volume ?? 0) ||
      (b.visitingCount ?? 0) - (a.visitingCount ?? 0) ||
      a.address.localeCompare(b.address),
  );

  return { passed, rejected };
}
