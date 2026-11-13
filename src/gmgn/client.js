import dns from "node:dns";
import { randomUUID } from "node:crypto";

dns.setDefaultResultOrder("ipv4first");

export class GmgnApiError extends Error {
  constructor(message, { status = null, code = null, retryAfterMs = null, body = null } = {}) {
    super(message);
    this.name = "GmgnApiError";
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.body = body;
  }
}

function normalizeCode(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function isSuccessPayload(payload) {
  const topCode = normalizeCode(payload?.code);
  const nestedCode = normalizeCode(payload?.data?.code);
  const topOk = topCode === 0 || topCode === 200;
  const nestedOk = nestedCode === null || nestedCode === 0 || nestedCode === 200;
  return topOk && nestedOk;
}

export function extractRankRows(payload) {
  const nested = payload?.data?.data;
  if (Array.isArray(nested?.rank)) return nested.rank;
  if (Array.isArray(nested)) return nested;
  if (Array.isArray(payload?.data?.rank)) return payload.data.rank;
  return null;
}

export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return 5000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return 5000;
}

export function buildRankQuery({
  gmgn,
  filters,
  now = Date.now,
  clientId = randomUUID(),
}) {
  const params = new URLSearchParams();
  params.set("chain", gmgn.chain);
  params.set("interval", gmgn.interval);
  params.set("limit", String(gmgn.limit));
  params.set("orderby", gmgn.orderby);
  params.set("direction", gmgn.direction);

  for (const [key, value] of Object.entries(filters.server ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }

  params.set("timestamp", String(Math.floor(now() / 1000)));
  params.set("client_id", clientId);
  return params;
}

export class GmgnClient {
  constructor({
    apiKey,
    baseUrl = "https://openapi.gmgn.ai",
    timeoutMs = 30000,
    limiter,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    clientIdFactory = randomUUID,
    logger = null,
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.limiter = limiter;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.clientIdFactory = clientIdFactory;
    this.logger = logger;
  }

  async rank({ gmgn, filters }) {
    if (!this.apiKey) throw new GmgnApiError("GMGN_API_KEY is not configured");
    if (this.limiter) await this.limiter.acquire();

    const params = buildRankQuery({
      gmgn,
      filters,
      now: this.now,
      clientId: this.clientIdFactory(),
    });
    const url = `${this.baseUrl}/v1/market/rank?${params.toString()}`;

    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          "X-APIKEY": this.apiKey,
          accept: "application/json",
          "user-agent": "bot-gmgn/0.1",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new GmgnApiError(`GMGN request failed: ${error.message}`, { body: null });
    }

    const text = await response.text();

    if (!response.ok) {
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), this.now());
      if (response.status === 429 && this.limiter) this.limiter.penalize(retryAfterMs);
      throw new GmgnApiError(`GMGN HTTP ${response.status}`, {
        status: response.status,
        retryAfterMs,
        body: text.slice(0, 500),
      });
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new GmgnApiError("GMGN response is not valid JSON", { body: text.slice(0, 500) });
    }

    if (!isSuccessPayload(payload)) {
      throw new GmgnApiError("GMGN API returned an error", {
        status: response.status,
        code: payload?.data?.code ?? payload?.code ?? null,
        body: text.slice(0, 500),
      });
    }

    const rows = extractRankRows(payload);
    if (!Array.isArray(rows)) {
      throw new GmgnApiError("GMGN response has no rank array", { body: text.slice(0, 500) });
    }

    return rows;
  }
}
