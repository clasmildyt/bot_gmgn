import path from "node:path";
import { GmgnClient } from "./gmgn/client.js";
import { MinIntervalLimiter } from "./gmgn/rate-limiter.js";
import { normalizeRows } from "./gmgn/normalize.js";
import { evaluateTokens } from "./filters/engine.js";
import { MeteoraClient } from "./meteora/pools.js";
import { TelegramClient } from "./telegram/bot.js";
import { StateStore } from "./state/store.js";
import { formatAlert } from "./report/format.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logDebugCycle(logger, tokens, passed, rejected) {
  logger.debug("debug cycle", {
    rows: tokens.length,
    passed: passed.length,
    rejected: rejected.length,
  });

  const topByVolume = [...tokens]
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, 10)
    .map((token) => ({
      symbol: token.symbol,
      visiting: token.visitingCount,
      volume: token.volume,
      swaps: token.swaps,
      mcap: token.marketCap,
      score: token.score,
    }));
  logger.debug("top by volume", { rows: topByVolume });

  const nearMisses = rejected
    .filter(({ token }) => {
      const visiting = token.visitingCount ?? 0;
      const volume = token.volume ?? 0;
      return (visiting >= 100 && volume >= 10000) || (visiting >= 50 && volume >= 50000);
    })
    .slice(0, 10)
    .map(({ token, reasons }) => ({
      symbol: token.symbol,
      visiting: token.visitingCount,
      volume: token.volume,
      reasons,
    }));
  logger.debug("near misses", { rows: nearMisses });
}

export async function runBot({
  config,
  configPath,
  env = process.env,
  logger,
  dryRun = false,
  debug = false,
  once = false,
}) {
  const apiKey = env.GMGN_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GMGN_API_KEY is required (set it in the environment or ~/.config/gmgn/.env)");
  }

  const telegramToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const telegramChatId = env.TELEGRAM_CHAT_ID?.trim();
  if (!dryRun && (!telegramToken || !telegramChatId)) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required unless --dry-run is used");
  }
  if (!dryRun && telegramToken.split(":")[0] === telegramChatId) {
    throw new Error(
      "TELEGRAM_CHAT_ID is the bot's own id; use your Telegram user/group chat id instead",
    );
  }

  const limiter = new MinIntervalLimiter({
    minIntervalMs: config.gmgn.poll_interval_sec * 1000,
    jitterMs: 250,
  });
  const gmgn = new GmgnClient({
    apiKey,
    timeoutMs: config.gmgn.request_timeout_ms,
    limiter,
    logger,
  });
  const meteora = new MeteoraClient({
    quoteMint: config.meteora.quote,
    timeoutMs: config.meteora.request_timeout_ms,
    cacheTtlMs: config.meteora.cache_ttl_sec * 1000,
    logger,
  });
  const telegram = dryRun
    ? null
    : new TelegramClient({
        token: telegramToken,
        chatId: telegramChatId,
        logger,
      });

  const statePath = path.resolve(process.cwd(), config.state.path);
  const state = new StateStore({ path: statePath, logger });
  await state.load();

  logger.info("bot starting", {
    configPath,
    statePath,
    dryRun,
    once,
    debug,
    chain: config.gmgn.chain,
    interval: config.gmgn.interval,
    pollIntervalSec: config.gmgn.poll_interval_sec,
    minVisitingCount: config.filters.server.min_visiting_count ?? null,
    minVolume: config.filters.server.min_volume ?? null,
  });

  let stopping = false;
  const requestStop = (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info("shutdown requested", { signal });
  };
  const onSigint = () => requestStop("SIGINT");
  const onSigterm = () => requestStop("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    while (!stopping) {
      const cycleStartedAt = Date.now();
      let tokens = [];
      let passed = [];
      let rejected = [];
      let alertsSent = 0;

      try {
        const rows = await gmgn.rank({ gmgn: config.gmgn, filters: config.filters });
        tokens = normalizeRows(rows);
        const evaluated = evaluateTokens(tokens, config);
        passed = evaluated.passed;
        rejected = evaluated.rejected;

        if (debug) {
          logDebugCycle(logger, tokens, passed, rejected);
          if (tokens.length === 0) {
            try {
              const probeRows = await gmgn.rank({
                gmgn: config.gmgn,
                filters: { server: {} },
              });
              const probeTokens = normalizeRows(probeRows);
              const probeEvaluated = evaluateTokens(probeTokens, config);
              logger.debug("debug probe without server filters", {
                rows: probeTokens.length,
              });
              logDebugCycle(
                logger,
                probeTokens,
                probeEvaluated.passed,
                probeEvaluated.rejected,
              );
            } catch (error) {
              logger.warn("debug probe failed", { error });
            }
          }
        }

        for (const token of passed) {
          const prior = state.get(token.address);
          state.markSeen(token, { passing: true });

          if (!state.shouldAlert(token, config.alert.repeat_sec)) continue;
          if (alertsSent >= config.alert.max_per_cycle) {
            logger.debug("alert cap reached", { symbol: token.symbol });
            continue;
          }

          let pool = null;
          let poolError = null;
          try {
            pool = await meteora.getBestPool(token.address, config.meteora);
          } catch (error) {
            poolError = error.message;
            logger.warn("meteora lookup failed", {
              symbol: token.symbol,
              address: token.address,
              error,
            });
          }

          if (config.meteora.require_pool && !pool) {
            logger.info("skip: no eligible Meteora pool", {
              symbol: token.symbol,
              address: token.address,
              poolError,
            });
            continue;
          }

          const repeatCount = prior?.lastSentAt ? (prior.repeatCount ?? 0) + 1 : 0;
          const html = formatAlert(token, pool, {
            repeatCount,
            showVisitingCount: config.alert.show_visiting_count,
            interval: config.gmgn.interval,
            quote: config.meteora.quote,
            poolError,
          });

          try {
            if (dryRun) {
              console.log(`\n--- DRY RUN ALERT ---\n${html}\n`);
            } else {
              await telegram.sendMessage(html);
            }
          } catch (error) {
            logger.error("alert delivery failed", {
              symbol: token.symbol,
              address: token.address,
              error,
            });
            continue;
          }

          state.markSent(token, { repeatCount });
          alertsSent += 1;
          logger.info("alert sent", {
            symbol: token.symbol,
            address: token.address,
            repeatCount,
            score: token.score,
            visitingCount: token.visitingCount,
            volume: token.volume,
            pool: pool?.address ?? null,
            dryRun,
          });
        }

        const passingMints = new Set(passed.map((token) => token.address));
        for (const [mint, entry] of Object.entries(state.all())) {
          if (!passingMints.has(mint)) entry.passing = false;
        }

        state.prune(config.state.retention_sec);
        await state.save();

        logger.info("cycle complete", {
          rows: tokens.length,
          passed: passed.length,
          rejected: rejected.length,
          alertsSent,
          durationMs: Date.now() - cycleStartedAt,
        });
      } catch (error) {
        logger.error("cycle failed", { error });
        if (error.status === 429) {
          logger.warn("GMGN rate limit hit; backing off", {
            retryAfterMs: error.retryAfterMs,
          });
        }
      }

      if (once) break;

      const elapsedMs = Date.now() - cycleStartedAt;
      const waitMs = Math.max(0, config.gmgn.poll_interval_sec * 1000 - elapsedMs);
      if (!stopping && waitMs > 0) await sleep(waitMs);
    }
  } finally {
    try {
      await state.save();
    } catch (error) {
      logger.error("failed to save state on shutdown", { error });
    }
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}
