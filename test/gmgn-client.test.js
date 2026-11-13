import test from "node:test";
import assert from "node:assert/strict";
import {
  GmgnApiError,
  GmgnClient,
  buildRankQuery,
  extractRankRows,
  parseRetryAfter,
} from "../src/gmgn/client.js";

const GMGN = {
  chain: "sol",
  interval: "5m",
  limit: 100,
  orderby: "volume",
  direction: "desc",
};

const FILTERS = {
  server: {
    min_visiting_count: 100,
    min_volume: 50_000,
    min_created: "5m",
  },
};

function response(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("buildRankQuery includes market, server filters, and auth params", () => {
  const params = buildRankQuery({
    gmgn: GMGN,
    filters: FILTERS,
    now: () => 1_700_000_000_000,
    clientId: "client-id",
  });
  assert.equal(params.get("chain"), "sol");
  assert.equal(params.get("interval"), "5m");
  assert.equal(params.get("limit"), "100");
  assert.equal(params.get("orderby"), "volume");
  assert.equal(params.get("direction"), "desc");
  assert.equal(params.get("min_visiting_count"), "100");
  assert.equal(params.get("min_volume"), "50000");
  assert.equal(params.get("min_created"), "5m");
  assert.equal(params.get("timestamp"), "1700000000");
  assert.equal(params.get("client_id"), "client-id");
});

test("extractRankRows handles the documented nested response", () => {
  assert.deepEqual(extractRankRows({ data: { data: { rank: [{ address: "mint" }] } } }), [
    { address: "mint" },
  ]);
  assert.deepEqual(extractRankRows({ data: { data: [{ address: "mint" }] } }), [
    { address: "mint" },
  ]);
  assert.equal(extractRankRows({ data: { data: {} } }), null);
});

test("parseRetryAfter supports seconds and dates", () => {
  assert.equal(parseRetryAfter("2"), 2000);
  assert.equal(parseRetryAfter("bad"), 5000);
  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(parseRetryAfter("Thu, 01 Jan 2026 00:00:02 GMT", now), 2000);
});

test("GmgnClient sends X-APIKEY and returns rank rows", async () => {
  let captured = null;
  const limiter = {
    acquired: 0,
    async acquire() {
      this.acquired += 1;
    },
    penalize() {},
  };
  const client = new GmgnClient({
    apiKey: "secret-key",
    limiter,
    now: () => 1_700_000_000_000,
    clientIdFactory: () => "client-id",
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return response({ code: 0, data: { code: 0, data: { rank: [{ address: "mint" }] } } });
    },
  });

  const rows = await client.rank({ gmgn: GMGN, filters: FILTERS });
  assert.equal(limiter.acquired, 1);
  assert.equal(rows.length, 1);
  assert.equal(captured.options.headers["X-APIKEY"], "secret-key");
  assert.ok(!captured.url.includes("secret-key"));
  assert.ok(captured.url.includes("timestamp=1700000000"));
  assert.ok(captured.url.includes("client_id=client-id"));
});

test("GmgnClient penalizes limiter on 429", async () => {
  let penalized = null;
  const limiter = {
    async acquire() {},
    penalize(ms) {
      penalized = ms;
    },
  };
  const client = new GmgnClient({
    apiKey: "secret-key",
    limiter,
    fetchImpl: async () => response({ error: "rate limited" }, 429, { "retry-after": "3" }),
  });

  await assert.rejects(
    () => client.rank({ gmgn: GMGN, filters: FILTERS }),
    (error) => error instanceof GmgnApiError && error.status === 429 && error.retryAfterMs === 3000,
  );
  assert.equal(penalized, 3000);
});

test("GmgnClient rejects API error payloads", async () => {
  const client = new GmgnClient({
    apiKey: "secret-key",
    fetchImpl: async () =>
      response({ code: 401, data: { code: 401, message: "invalid key" } }, 200),
  });
  await assert.rejects(
    () => client.rank({ gmgn: GMGN, filters: FILTERS }),
    (error) => error instanceof GmgnApiError && error.code === 401,
  );
});
