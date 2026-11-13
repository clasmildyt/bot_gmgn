function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatUsd(value) {
  if (!isNumber(value)) return "n/a";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

export function formatPrice(value) {
  if (!isNumber(value)) return "n/a";
  const abs = Math.abs(value);
  if (abs >= 1) return `$${value.toFixed(4)}`;
  if (abs >= 0.01) return `$${value.toFixed(6)}`;
  if (abs === 0) return "$0";
  return `$${value.toPrecision(6)}`;
}

export function formatInt(value) {
  if (!isNumber(value)) return "n/a";
  return Math.round(value).toLocaleString("en-US");
}

export function formatRate(value) {
  if (!isNumber(value)) return "n/a";
  return `${(value * 100).toFixed(2)}%`;
}

export function formatPercent(value) {
  if (!isNumber(value)) return "n/a";
  return `${value.toFixed(2)}%`;
}

export function formatAge(seconds) {
  if (!isNumber(seconds) || seconds < 0) return "n/a";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return minutes ? `${hours}h${minutes}m` : `${hours}h`;
  }
  return `${Math.floor(seconds / 86400)}d`;
}

export function formatBool(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "n/a";
}

export function truncateMessage(text, maxLength = 4000) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

export function formatAlert(
  token,
  pool,
  {
    repeatCount = 0,
    showVisitingCount = true,
    interval = "5m",
    quote = "SOL",
    poolError = null,
    maxLength = 4000,
  } = {},
) {
  const gmgnUrl = `https://gmgn.ai/sol/token/${token.address}`;
  const quoteLabel = String(quote || "SOL").trim();
  const lines = [];

  const title = token.name && token.name !== token.symbol
    ? `<b>${escapeHtml(token.symbol)}</b> — ${escapeHtml(token.name)}`
    : `<b>${escapeHtml(token.symbol)}</b>`;
  lines.push(title);
  if (repeatCount > 0) lines.push(`<b>[REPEAT #${repeatCount}]</b>`);
  lines.push(`CA: <code>${escapeHtml(token.address)}</code>`);
  lines.push(`GMGN: <a href="${escapeHtml(gmgnUrl)}">${escapeHtml(gmgnUrl)}</a>`);
  if (pool) {
    lines.push(`Meteora: <a href="${escapeHtml(pool.url)}">${escapeHtml(pool.url)}</a>`);
  } else if (poolError) {
    lines.push(`Meteora: lookup failed (${escapeHtml(poolError)})`);
  } else {
    lines.push(`Meteora: no eligible ${escapeHtml(quoteLabel)}/DLMM pool found`);
  }

  lines.push(`Score: ${formatInt(token.score)}/100`);
  if (showVisitingCount) lines.push(`Visiting: ${formatInt(token.visitingCount)}`);
  lines.push(
    `Mcap: ${formatUsd(token.marketCap)} | Liquidity: ${formatUsd(token.liquidity)} | Volume ${interval}: ${formatUsd(token.volume)}`,
  );
  lines.push(
    `Swaps: ${formatInt(token.swaps)} (B ${formatInt(token.buys)} / S ${formatInt(token.sells)}) | Holders: ${formatInt(token.holderCount)} | Age: ${formatAge(token.ageSec)}`,
  );
  lines.push(
    `Price: ${formatPrice(token.price)} | 1m: ${formatPercent(token.priceChange1m)} | 5m: ${formatPercent(token.priceChange5m)} | 1h: ${formatPercent(token.priceChange1h)}`,
  );
  lines.push(
    `Security: honeypot ${formatBool(token.isHoneypot)} | wash ${formatBool(token.isWashTrading)} | mint renounced ${formatBool(token.renouncedMint)} | freeze renounced ${formatBool(token.renouncedFreeze)}`,
  );
  lines.push(
    `Top10: ${formatRate(token.top10HolderRate)} | Bundler: ${formatRate(token.bundlerRate)} | Insider: ${formatRate(token.insiderRate)} | Dev: ${formatRate(token.devTeamHoldRate)}`,
  );

  if (pool) {
    lines.push(
      `Pool: ${escapeHtml(pool.label)} | TVL ${formatUsd(pool.tvl)} | Active ${formatUsd(pool.activeTvl)} | Vol ${formatUsd(pool.volume)} | Fee/TVL ${formatRate(pool.feeActiveTvlRatio)} | Bin ${formatInt(pool.binStep)}`,
    );
  }

  return truncateMessage(lines.join("\n"), maxLength);
}
