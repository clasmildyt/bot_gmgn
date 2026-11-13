export class TelegramClient {
  constructor({
    token,
    chatId,
    fetchImpl = globalThis.fetch,
    timeoutMs = 15000,
    logger = null,
  } = {}) {
    this.token = token;
    this.chatId = chatId;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
  }

  async sendMessage(text) {
    if (!this.token || !this.chatId) {
      throw new Error("Telegram token/chat id is not configured");
    }

    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok || payload?.ok !== true) {
      const description = payload?.description ?? `HTTP ${response.status}`;
      throw new Error(`Telegram send failed: ${description}`);
    }

    return payload.result;
  }
}
