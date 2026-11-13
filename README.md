# bot-gmgn

Report-only GMGN Solana trend screener with Meteora DLMM pool lookup and
Telegram alerts. It never signs or submits transactions.

## Requirements

- Linux (tested on Ubuntu ARM64 / `aarch64`)
- Node.js >= 20.11 (Node 22 LTS recommended)
- Outbound HTTPS access to GMGN and `api.telegram.org`
- No inbound ports required

All dependencies are pure JavaScript, so no compiler/build tools are needed on
ARM.

## Install on Ubuntu ARM64

### 1. Install Node.js and git

Ubuntu's packaged Node.js is usually too old. Use NodeSource:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt-get install -y nodejs
node -v   # must be >= v20.11
```

Check the architecture with `uname -m`; it should print `aarch64`.

### 2. Clone and install

```bash
git clone https://github.com/<your-user>/<your-repo>.git
cd <your-repo>
npm ci
```

### 3. Add secrets

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Fill in:

```env
GMGN_API_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

`TELEGRAM_*` can be left empty for `--dry-run`. Alternatively, place the same
values in `~/.config/gmgn/.env`; the project `.env` takes precedence.

Never commit `.env`. It is already listed in `.gitignore`.

### 4. Configure filters

Edit `config.yaml` and tune `filters.server`, `filters.client`, `meteora`, and
`alert`. Rates are decimals (`0.25` = 25%).

### 5. Smoke test

```bash
npm test
node src/index.js --config ./config.yaml --dry-run --once --debug
```

This prints alerts to stdout without sending Telegram messages.

### 6. Run for real

```bash
node src/index.js --config ./config.yaml
```

## Run as a systemd service

Create a dedicated user, install the app, and set permissions:

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin botgmgn
sudo git clone https://github.com/<your-user>/<your-repo>.git /opt/bot-gmgn
cd /opt/bot-gmgn
sudo npm ci
sudo cp .env.example .env
sudo nano .env                 # fill in the secrets
sudo chmod 600 .env
sudo chown -R botgmgn:botgmgn /opt/bot-gmgn
```

Install the unit (adjust paths/user if you did not use `/opt/bot-gmgn`):

```bash
sudo cp deploy/bot-gmgn.service /etc/systemd/system/bot-gmgn.service
sudo systemctl daemon-reload
sudo systemctl enable --now bot-gmgn
sudo systemctl status bot-gmgn
```

Follow logs:

```bash
journalctl -u bot-gmgn -f
```

Update later:

```bash
cd /opt/bot-gmgn
sudo -u botgmgn git pull --ff-only
sudo npm ci
sudo systemctl restart bot-gmgn
```

## Repository hygiene

Commit only source and config:

- `src/`, `test/`, `package.json`, `package-lock.json`, `config.yaml`
- `.env.example`, `README.md`, `deploy/`

Do **not** commit:

- `.env` (API keys / bot token)
- `node_modules/`
- `data/` (`state.json` contains runtime state)

If a secret is ever committed, revoke it and generate a new one; deleting the
file in a later commit is not enough.

## Troubleshooting

| Symptom | Check |
|---|---|
| `node: command not found` / old version | `node -v`; reinstall Node 22 |
| `401`/`403` from GMGN | `GMGN_API_KEY` in `.env` |
| Telegram "chat not found" | `TELEGRAM_CHAT_ID` is the chat id, not the bot id; send `/start` to the bot first |
| Telegram "bot can't send messages to the bot" | `TELEGRAM_CHAT_ID` accidentally set to the bot's own id |
| HTTP 429 from GMGN | Keep `gmgn.poll_interval_sec` >= 5 and run only one instance |
| No alerts | Test with `--dry-run --once --debug`; filters may be too strict |
| Service restarts repeatedly | `journalctl -u bot-gmgn -n 100 --no-pager` |
