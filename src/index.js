import path from "node:path";
import { loadConfig, loadEnvFiles } from "./config.js";
import { createLogger } from "./logger.js";
import { runBot } from "./runtime.js";

function usage() {
  return [
    "Usage: node src/index.js [options]",
    "",
    "Options:",
    "  --config <path>  Config file (default: ./config.yaml)",
    "  --once           Run one cycle and exit",
    "  --dry-run        Print alerts to stdout instead of Telegram",
    "  --debug          Print candidate/near-miss details",
    "  --help           Show this help",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { once: false, dryRun: false, debug: false, help: false, configPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--once") args.once = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--debug") args.debug = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--config") {
      index += 1;
      if (!argv[index]) throw new Error("--config requires a path");
      args.configPath = argv[index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  loadEnvFiles({ cwd: process.cwd() });
  const { config, configPath } = loadConfig({
    configPath: args.configPath ? path.resolve(args.configPath) : undefined,
    cwd: process.cwd(),
  });
  const logger = createLogger({
    level: args.debug ? "debug" : config.logging.level,
    json: config.logging.json,
  });

  await runBot({
    config,
    configPath,
    logger,
    dryRun: args.dryRun,
    debug: args.debug,
    once: args.once,
  });
}

main().catch((error) => {
  const logger = createLogger({ level: "error" });
  logger.error("fatal", { error });
  process.exitCode = 1;
});
