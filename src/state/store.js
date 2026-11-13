import fs from "node:fs/promises";
import path from "node:path";

function snapshot(token) {
  return {
    symbol: token.symbol,
    name: token.name,
    price: token.price,
    marketCap: token.marketCap,
    liquidity: token.liquidity,
    volume: token.volume,
    swaps: token.swaps,
    holderCount: token.holderCount,
    visitingCount: token.visitingCount,
    score: token.score,
    ageSec: token.ageSec,
    top10HolderRate: token.top10HolderRate,
    bundlerRate: token.bundlerRate,
    insiderRate: token.insiderRate,
    devTeamHoldRate: token.devTeamHoldRate,
    isHoneypot: token.isHoneypot,
    isWashTrading: token.isWashTrading,
    renouncedMint: token.renouncedMint,
    renouncedFreeze: token.renouncedFreeze,
  };
}

export class StateStore {
  constructor({ path: statePath, now = () => Date.now(), logger = null } = {}) {
    this.path = statePath;
    this.now = now;
    this.logger = logger;
    this.state = { version: 1, tokens: {} };
  }

  async load() {
    try {
      const raw = await fs.readFile(this.path, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || typeof parsed.tokens !== "object") {
        throw new Error("invalid state shape");
      }
      this.state = {
        version: parsed.version ?? 1,
        tokens: parsed.tokens ?? {},
      };
    } catch (error) {
      if (error.code === "ENOENT") {
        this.state = { version: 1, tokens: {} };
        return this.state;
      }

      const backupPath = `${this.path}.corrupt-${this.now()}`;
      try {
        await fs.rename(this.path, backupPath);
        this.logger?.warn("state file corrupt; backed up and reset", { backupPath });
      } catch {
        this.logger?.warn("state file corrupt; reset without backup");
      }
      this.state = { version: 1, tokens: {} };
    }

    return this.state;
  }

  all() {
    return this.state.tokens;
  }

  get(mint) {
    return this.state.tokens[mint] ?? null;
  }

  markSeen(token, { passing }) {
    const timestamp = new Date(this.now()).toISOString();
    const entry = this.state.tokens[token.address] ?? {
      firstSeenAt: timestamp,
      repeatCount: 0,
      lastSentAt: null,
    };
    entry.lastSeenAt = timestamp;
    entry.passing = passing;
    entry.symbol = token.symbol;
    entry.lastSnapshot = snapshot(token);
    this.state.tokens[token.address] = entry;
    return entry;
  }

  shouldAlert(token, repeatSec) {
    const entry = this.get(token.address);
    if (!entry?.lastSentAt) return true;
    const lastSentAt = Date.parse(entry.lastSentAt);
    if (!Number.isFinite(lastSentAt)) return true;
    return this.now() - lastSentAt >= repeatSec * 1000;
  }

  markSent(token, { repeatCount }) {
    const timestamp = new Date(this.now()).toISOString();
    const entry = this.state.tokens[token.address] ?? {
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      repeatCount: 0,
      lastSentAt: null,
    };
    entry.lastSentAt = timestamp;
    entry.lastSeenAt = timestamp;
    entry.passing = true;
    entry.repeatCount = repeatCount;
    entry.symbol = token.symbol;
    entry.lastSnapshot = snapshot(token);
    this.state.tokens[token.address] = entry;
    return entry;
  }

  prune(retentionSec) {
    const cutoff = this.now() - retentionSec * 1000;
    for (const [mint, entry] of Object.entries(this.state.tokens)) {
      const lastSeenAt = Date.parse(entry.lastSeenAt ?? entry.firstSeenAt ?? "");
      if (!Number.isFinite(lastSeenAt) || lastSeenAt < cutoff) {
        delete this.state.tokens[mint];
      }
    }
  }

  async save() {
    await fs.mkdir(path.dirname(this.path), { recursive: true });
    const tempPath = `${this.path}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.path);
  }
}
