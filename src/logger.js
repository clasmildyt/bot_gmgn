const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function serializeError(error) {
  if (!(error instanceof Error)) return error;
  return {
    name: error.name,
    message: error.message,
    ...(error.status != null ? { status: error.status } : {}),
    ...(error.code != null ? { code: error.code } : {}),
    ...(error.retryAfterMs != null ? { retryAfterMs: error.retryAfterMs } : {}),
  };
}

export function createLogger({ level = "info", json = false, sink = console } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(entryLevel, message, meta = {}) {
    if ((LEVELS[entryLevel] ?? LEVELS.info) < threshold) return;
    const cleanMeta = {};
    for (const [key, value] of Object.entries(meta)) {
      if (key === "error") cleanMeta.error = serializeError(value);
      else cleanMeta[key] = value;
    }
    const entry = {
      ts: new Date().toISOString(),
      level: entryLevel,
      message,
      ...cleanMeta,
    };
    if (json) {
      sink.log(JSON.stringify(entry));
      return;
    }
    const suffix = Object.keys(cleanMeta).length ? ` ${JSON.stringify(cleanMeta)}` : "";
    sink.log(`[${entry.ts}] ${entryLevel.toUpperCase()} ${message}${suffix}`);
  }

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
    level,
  };
}
