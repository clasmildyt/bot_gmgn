export class MinIntervalLimiter {
  constructor({
    minIntervalMs = 5000,
    jitterMs = 250,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.jitterMs = Math.max(0, jitterMs);
    this.now = now;
    this.sleep = sleep;
    this.nextAllowedAt = 0;
  }

  async acquire() {
    const now = this.now();
    const scheduledAt = Math.max(now, this.nextAllowedAt);
    this.nextAllowedAt = scheduledAt + this.minIntervalMs;

    const waitMs = scheduledAt - now;
    if (waitMs <= 0) return;

    const jitter = this.jitterMs > 0 ? Math.floor(Math.random() * this.jitterMs) : 0;
    await this.sleep(waitMs + jitter);
  }

  penalize(ms) {
    const until = this.now() + Math.max(0, ms);
    if (until > this.nextAllowedAt) this.nextAllowedAt = until;
  }
}
