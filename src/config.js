import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import YAML from "yaml";
import { z } from "zod";

const finiteNumber = z.number().finite();
const nullableNumber = finiteNumber.nullable().default(null);

const gmgnSchema = z
  .object({
    chain: z.string().min(1).default("sol"),
    interval: z.enum(["1m", "5m", "1h", "6h", "24h"]).default("5m"),
    limit: z.number().int().min(1).max(100).default(100),
    orderby: z.string().min(1).default("volume"),
    direction: z.enum(["asc", "desc"]).default("desc"),
    poll_interval_sec: z.number().int().min(1).default(5),
    request_timeout_ms: z.number().int().min(1000).default(30000),
  })
  .prefault({});

const serverFiltersSchema = z
  .record(z.string(), z.union([finiteNumber, z.string(), z.null()]))
  .default({});

const clientFiltersSchema = z
  .object({
    reject_honeypot: z.boolean().default(true),
    reject_wash_trading: z.boolean().default(true),
    require_mint_renounced: z.boolean().default(true),
    require_freeze_renounced: z.boolean().default(true),
    max_buy_tax: nullableNumber,
    max_sell_tax: nullableNumber,
    min_volume_liquidity_ratio: nullableNumber,
    max_volume_liquidity_ratio: nullableNumber,
    min_buy_sell_ratio: nullableNumber,
    max_buy_sell_ratio: nullableNumber,
    min_price_change_1m: nullableNumber,
    max_price_change_1m: nullableNumber,
    min_price_change_5m: nullableNumber,
    max_price_change_5m: nullableNumber,
    min_price_change_1h: nullableNumber,
    max_price_change_1h: nullableNumber,
    min_price_vs_ath: nullableNumber,
    max_price_vs_ath: nullableNumber,
    require_social: z.boolean().default(false),
    min_age_sec: nullableNumber,
    max_age_sec: nullableNumber,
  })
  .prefault({});

const filtersSchema = z
  .object({
    server: serverFiltersSchema,
    client: clientFiltersSchema,
  })
  .prefault({});

const alertSchema = z
  .object({
    repeat_sec: z.number().int().min(30).default(300),
    show_visiting_count: z.boolean().default(true),
    max_per_cycle: z.number().int().min(1).default(5),
  })
  .prefault({});

const meteoraSchema = z
  .object({
    quote: z.string().min(1).default("SOL"),
    require_pool: z.boolean().default(false),
    min_tvl: nullableNumber,
    min_active_tvl: nullableNumber,
    min_volume: nullableNumber,
    min_fee_active_tvl_ratio: nullableNumber,
    min_bin_step: nullableNumber,
    max_bin_step: nullableNumber,
    cache_ttl_sec: z.number().int().min(0).default(60),
    request_timeout_ms: z.number().int().min(1000).default(15000),
  })
  .prefault({});

const scoringSchema = z
  .object({
    enabled: z.boolean().default(false),
    min_score: z.number().min(0).max(100).default(60),
  })
  .prefault({});

const stateSchema = z
  .object({
    path: z.string().min(1).default("data/state.json"),
    retention_sec: z.number().int().min(60).default(86400),
  })
  .prefault({});

const loggingSchema = z
  .object({
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
    json: z.boolean().default(false),
  })
  .prefault({});

export const ConfigSchema = z.object({
  gmgn: gmgnSchema,
  filters: filtersSchema,
  alert: alertSchema,
  meteora: meteoraSchema,
  scoring: scoringSchema,
  state: stateSchema,
  logging: loggingSchema,
});

export function loadEnvFiles({ cwd = process.cwd(), home = os.homedir(), env = process.env } = {}) {
  const files = [path.join(cwd, ".env"), path.join(home, ".config", "gmgn", ".env")];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const parsed = dotenv.parse(fs.readFileSync(file, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (env[key] === undefined) env[key] = value;
    }
  }
  return env;
}

export function loadConfig({ configPath, cwd = process.cwd() } = {}) {
  const resolvedPath = path.resolve(configPath ?? path.join(cwd, "config.yaml"));
  const raw = YAML.parse(fs.readFileSync(resolvedPath, "utf8"));
  return {
    config: ConfigSchema.parse(raw),
    configPath: resolvedPath,
  };
}
