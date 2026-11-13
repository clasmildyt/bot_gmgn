export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

export const QUOTE_MINTS = {
  SOL: SOL_MINT,
  USDC: USDC_MINT,
  USDT: USDT_MINT,
};

export function resolveQuoteMint(quote) {
  if (typeof quote !== "string") return null;
  const value = quote.trim();
  if (!value) return null;
  return QUOTE_MINTS[value.toUpperCase()] ?? value;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const WINDOW_KEYS = ["24h", "12h", "4h", "2h", "1h", "30m"];

// The Meteora Data API returns volume and fee_tvl_ratio as { "30m": ..., "24h": ... }.
// Prefer 24h, then fall back to the widest window that is present.
function windowNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    for (const key of WINDOW_KEYS) {
      const number = numberOrNull(value[key]);
      if (number !== null) return number;
    }
    return null;
  }
  return numberOrNull(value);
}

function feeTvlRatio(pool) {
  const explicit = numberOrNull(pool.fee_active_tvl_ratio);
  if (explicit !== null) return explicit;

  // fee_tvl_ratio is a percentage in the current API (16.95 = 16.95%).
  const value = windowNumber(pool.fee_tvl_ratio);
  return value === null ? null : value / 100;
}

function normalizePool(pool, mint, quoteMint) {
  if (!pool || typeof pool !== "object") return null;

  const tokenX = pool.token_x?.address ?? pool.token_x?.mint ?? null;
  const tokenY = pool.token_y?.address ?? pool.token_y?.mint ?? null;
  const baseIsX = tokenX === mint && tokenY === quoteMint;
  const baseIsY = tokenY === mint && tokenX === quoteMint;
  if (!baseIsX && !baseIsY) return null;

  const address = pool.address ?? pool.pool_address ?? null;
  if (!address) return null;

  const poolType = pool.pool_type ?? pool.type ?? null;
  if (poolType !== null && String(poolType).toLowerCase() !== "dlmm") return null;

  return {
    address,
    baseMint: mint,
    quoteMint,
    poolType: poolType ?? "dlmm",
    isBlacklisted: pool.is_blacklisted ?? null,
    tvl: numberOrNull(pool.tvl),
    activeTvl: numberOrNull(pool.active_tvl ?? pool.activeTvl),
    volume: windowNumber(pool.volume),
    feeActiveTvlRatio: feeTvlRatio(pool),
    binStep: numberOrNull(pool.dlmm_params?.bin_step ?? pool.pool_config?.bin_step),
    volatility: numberOrNull(pool.volatility),
    poolPrice: numberOrNull(pool.pool_price ?? pool.current_price),
    url: `https://app.meteora.ag/dlmm/${address}`,
    label: `DLMM ${address.slice(0, 6)}...${address.slice(-4)}`,
  };
}

function passesPoolFilters(pool, filters) {
  if (pool.isBlacklisted === true) return false;

  for (const [label, actual, min, max] of [
    ["TVL", pool.tvl, filters.min_tvl, null],
    ["active TVL", pool.activeTvl, filters.min_active_tvl, null],
    ["volume", pool.volume, filters.min_volume, null],
    ["fee/active TVL", pool.feeActiveTvlRatio, filters.min_fee_active_tvl_ratio, null],
    ["bin step", pool.binStep, filters.min_bin_step, filters.max_bin_step],
  ]) {
    if (min !== null && min !== undefined) {
      if (actual === null || actual === undefined || actual < min) return false;
    }
    if (max !== null && max !== undefined) {
      if (actual === null || actual === undefined || actual > max) return false;
    }
  }

  return true;
}

export class MeteoraClient {
  constructor({
    baseUrl = "https://dlmm.datapi.meteora.ag",
    quoteMint = SOL_MINT,
    timeoutMs = 15000,
    cacheTtlMs = 60000,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    logger = null,
  } = {}) {
    this.baseUrl = baseUrl;
    this.quoteMint = resolveQuoteMint(quoteMint) ?? SOL_MINT;
    this.timeoutMs = timeoutMs;
    this.cacheTtlMs = cacheTtlMs;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.logger = logger;
    this.cache = new Map();
    this.inflight = new Map();
  }

  async fetchPools(mint) {
    const url = new URL("/pools", this.baseUrl);
    url.searchParams.set("query", mint);
    url.searchParams.set("page_size", "50");
    url.searchParams.set("sort_by", "tvl:desc");

    const response = await this.fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": "bot-gmgn/0.1" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Meteora HTTP ${response.status}`);
    }

    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : payload?.data;
    if (!Array.isArray(rows)) {
      throw new Error("Meteora response has no pool array");
    }

    return rows.map((pool) => normalizePool(pool, mint, this.quoteMint)).filter(Boolean);
  }

  async getPools(mint) {
    const cached = this.cache.get(mint);
    if (cached && cached.expiresAt > this.now()) return cached.pools;

    if (this.inflight.has(mint)) return this.inflight.get(mint);

    const promise = this.fetchPools(mint)
      .then((pools) => {
        this.cache.set(mint, {
          expiresAt: this.now() + this.cacheTtlMs,
          pools,
        });
        return pools;
      })
      .finally(() => {
        this.inflight.delete(mint);
      });

    this.inflight.set(mint, promise);
    return promise;
  }

  async getBestPool(mint, filters = {}) {
    const pools = await this.getPools(mint);
    const eligible = pools.filter((pool) => passesPoolFilters(pool, filters));
    eligible.sort(
      (a, b) =>
        (b.feeActiveTvlRatio ?? -Infinity) - (a.feeActiveTvlRatio ?? -Infinity) ||
        (b.activeTvl ?? -Infinity) - (a.activeTvl ?? -Infinity) ||
        (b.tvl ?? -Infinity) - (a.tvl ?? -Infinity) ||
        a.address.localeCompare(b.address),
    );
    return eligible[0] ?? null;
  }

  clearCache() {
    this.cache.clear();
    this.inflight.clear();
  }
}
