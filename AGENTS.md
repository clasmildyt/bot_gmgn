# bot-gmgn — Agent Notes

Report-only GMGN Solana trend screener. It polls GMGN's ranking API, applies
server-side and local filters, looks up the best Meteora DLMM pool, and sends
Telegram alerts. It never signs or submits transactions.

## Commands

```bash
npm install
npm test
npm run dry-run          # one-off alerts to stdout
npm start                # live loop
npm run debug            # extra candidate/near-miss logging
npm run once             # single cycle
node src/index.js --config ./config.yaml --dry-run --once --debug
```

Secrets live in `.env` (project) or `~/.config/gmgn/.env` (fallback):

```env
GMGN_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

`TELEGRAM_*` is optional when using `--dry-run`.

## Layout

| Path | Purpose |
|---|---|
| `src/index.js` | CLI argument parsing and startup |
| `src/config.js` | Zod schema, YAML loading, `.env` discovery |
| `src/runtime.js` | Poll loop, filtering, alerting, state updates |
| `src/gmgn/client.js` | GMGN `/v1/market/rank` client, query builder, 429 handling |
| `src/gmgn/rate-limiter.js` | Minimum-interval limiter with jitter/penalty |
| `src/gmgn/normalize.js` | GMGN row normalization, derived ratios, heuristic score |
| `src/filters/engine.js` | Server-filter mirror checks, client filters, scoring gate |
| `src/meteora/pools.js` | Meteora DLMM pool lookup, quote-mint matching, cache |
| `src/report/format.js` | Telegram HTML alert formatting and escaping |
| `src/state/store.js` | Atomic JSON state, repeat cooldown, retention pruning |
| `src/telegram/bot.js` | Telegram `sendMessage` client |
| `src/logger.js` | Text/JSON logger |

## Runtime Behavior

1. Poll `/v1/market/rank` every `gmgn.poll_interval_sec` (default 5s).
2. Pass `filters.server` through as query params; re-check them locally too.
3. Apply `filters.client` after normalization. Missing security fields are
   rejected when the corresponding filter is enabled.
4. Sort passing tokens by score, volume, then visiting count.
5. Look up the best Meteora DLMM pool for the configured quote mint.
6. Send the first alert immediately, then repeat after `alert.repeat_sec`
   (default 300s) while the token still passes. `alert.max_per_cycle` caps
   sends per cycle.
7. Persist state in `state.path` (default `data/state.json`) after each cycle
   and on shutdown.

`--debug` logs the top rows and near misses. If server filters return zero
rows, it also probes the rank endpoint without server filters to show whether
the filters or the market data are responsible.

## Config Notes

- `filters.server`: keys are forwarded to GMGN as-is; `null`/empty disables.
- `filters.client`: local checks for derived values, taxes, socials, and age.
- `meteora.quote`: `SOL` (default), `USDC`, `USDT`, or a raw Solana mint
  address. Symbols are resolved in `src/meteora/pools.js`; the same value is
  used in the alert's no-pool message.
- `meteora.require_pool`: when true, skip alerts without an eligible pool.
- `scoring.enabled`: when true, `scoring.min_score` becomes a hard filter;
  otherwise the score is only displayed and used for ordering.
- `state.retention_sec`: entries not seen within this window are pruned.

## Verification

`npm test` covers config defaults/loading, env precedence, normalization,
scoring, server/client filters, GMGN query/auth/error handling, rate limiting,
Meteora pool selection (including non-SOL quotes), Telegram formatting,
and state persistence/retention.

Last verified: 2026-11-05 — 43 tests passing.

## Changelog

### 2026-11-04 — Initial implementation
- Built the Node.js ESM screener, YAML/Zod config, GMGN client, normalization,
  filters, Meteora pool selection, Telegram formatter, JSON state store, and
  poll runtime.
- Added unit tests and a live `--dry-run --once --debug` smoke test.
- Added a debug probe for cycles where server filters return zero rows.

### 2026-11-05 — Fix Meteora parsing and Telegram misconfiguration guard
- Mapped the current Meteora Data API shape: windowed `volume` and
  `fee_tvl_ratio`, `pool_config.bin_step`, `current_price`, and a TVL fallback
  in pool ordering. Previously these fields normalized to `null`, so pool
  filters/sorting silently did nothing and alert stats showed `n/a`.
- Added a startup guard for `TELEGRAM_CHAT_ID` being the bot's own id (the
  actual failure mode: Telegram returns "the bot can't send messages to the
  bot" and the old loop retried every poll).
- Added regression tests for the live Meteora payload shape (43 total).

### 2026-11-04 — Wire up `meteora.quote`
- Resolved the outstanding TODO where `meteora.quote` was parsed but never
  used. `MeteoraClient` now accepts quote symbols (`SOL`, `USDC`, `USDT`) or a
  raw mint address, and the runtime passes the configured quote through.
- Alert text now reports the configured quote when no eligible pool is found.
- Added tests for quote resolution, non-SOL pool selection, and the alert
  message.

## Known Limitations / Next Steps

- `market/token_signal` is intentionally not implemented (trend-only MVP).
- Enrichment beyond the rank response (token info/security/holders/traders) is
  not implemented; the rank payload is assumed to contain the needed fields.
- State is JSON, not SQLite. It is sufficient for the current token volume.
- GMGN Free plan is rate-limited; avoid lowering `poll_interval_sec` below 5s
  or adding parallel rank requests.
