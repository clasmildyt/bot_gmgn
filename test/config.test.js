import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConfigSchema, loadConfig, loadEnvFiles } from "../src/config.js";

test("ConfigSchema applies safe defaults", () => {
  const config = ConfigSchema.parse({});
  assert.equal(config.gmgn.chain, "sol");
  assert.equal(config.gmgn.interval, "5m");
  assert.equal(config.gmgn.poll_interval_sec, 5);
  assert.deepEqual(config.filters.server, {});
  assert.equal(config.filters.client.reject_honeypot, true);
  assert.equal(config.alert.repeat_sec, 300);
  assert.equal(config.meteora.quote, "SOL");
  assert.equal(config.state.path, "data/state.json");
});

test("ConfigSchema accepts server filters and client filters", () => {
  const config = ConfigSchema.parse({
    filters: {
      server: { min_visiting_count: 100, min_volume: 50000, min_created: "5m" },
      client: { max_buy_tax: 0.1, min_buy_sell_ratio: 1.2 },
    },
  });
  assert.equal(config.filters.server.min_visiting_count, 100);
  assert.equal(config.filters.server.min_created, "5m");
  assert.equal(config.filters.client.max_buy_tax, 0.1);
  assert.equal(config.filters.client.min_buy_sell_ratio, 1.2);
});

test("loadConfig reads YAML from disk", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bot-gmgn-config-"));
  try {
    const configPath = path.join(dir, "config.yaml");
    await fs.writeFile(
      configPath,
      [
        "gmgn:",
        "  interval: 1m",
        "filters:",
        "  server:",
        "    min_visiting_count: 100",
        "    min_volume: 50000",
        "",
      ].join("\n"),
    );
    const { config, configPath: loadedPath } = loadConfig({ configPath });
    assert.equal(loadedPath, configPath);
    assert.equal(config.gmgn.interval, "1m");
    assert.equal(config.filters.server.min_visiting_count, 100);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("loadEnvFiles prefers process env, then project, then home", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bot-gmgn-env-"));
  try {
    const cwd = path.join(root, "project");
    const home = path.join(root, "home");
    await fs.mkdir(cwd, { recursive: true });
    await fs.mkdir(path.join(home, ".config", "gmgn"), { recursive: true });
    await fs.writeFile(path.join(cwd, ".env"), "GMGN_API_KEY=project-key\n");
    await fs.writeFile(
      path.join(home, ".config", "gmgn", ".env"),
      "GMGN_API_KEY=home-key\nTELEGRAM_CHAT_ID=home-chat\n",
    );

    const env = {};
    loadEnvFiles({ cwd, home, env });
    assert.equal(env.GMGN_API_KEY, "project-key");
    assert.equal(env.TELEGRAM_CHAT_ID, "home-chat");

    const withProcess = { GMGN_API_KEY: "process-key" };
    loadEnvFiles({ cwd, home, env: withProcess });
    assert.equal(withProcess.GMGN_API_KEY, "process-key");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
