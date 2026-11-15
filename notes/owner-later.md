# Owner: things to do later

Plain list for the owner. Each item says what to do, why, and what waits for it. The coordinator adds items; the owner removes an item when it is done (or tells the coordinator).

## 1. Run the private model on your PC (F111 owner step O2)

- **Why:** stage 05 of F111 measures how well two own models (Bielik 11B and Gemma 3 12B) sort mail. It needs your GPU. Without it, the guide `docs/own-model.md` has no numbers.
- **What to do (about 15 minutes, then the agent runs about 2 hours):**
  1. In a terminal: `sudo pacman -S ollama-rocm` (the AMD GPU build of Ollama; your RX 6950 XT).
  2. Check that about 16 GB of disk are free in your home folder: `df -h ~`.
  3. Tell the coordinator: "ollama-rocm is in, run F111 stage 05".
- **Other option:** say "rent a GPU" instead. Cost: at most $5.
- **What waits:** only F111 stage 05. Everything else of F111 is built or parked (stage 07, the EU option, is parked: you chose the default US API).
- **Added:** 2026-11-15.

## 2. An API key for the reply-draft model (F115 stage 02)

- **Why:** you want another model and provider for reply drafts (for example DeepSeek through its API). The test run of stage 02 needs that key.
- **What to do:** make an API key at the provider. Put it in the dev `.env` yourself (never paste it in chat). Tell the coordinator the provider and the key name.
- **Note:** the product refuses hosted OpenAI-compatible APIs today (F111 D3). A new provider needs a small ticket; the coordinator plans it when you have the key.
- **What waits:** only F115 stage 02 (about $6 of LLM spend). Stages 03 and later build now.
- **Added:** 2026-11-15.

## 3. The backup restore drill (F114 stage 09 part C)

- **Why:** the drill proves that a backup really restores. It needs your backup key; no agent may hold it.
- **What to do:**
  1. Find the `age` key file that decrypts the backups (`*.dump.age`). Tell the coordinator its path on this PC.
  2. Make a Healthchecks.io check "backup" (period 1 day, grace 2 h). Put its URL as `BACKUP_PING_URL` in `deploy/backup.env` on the VPS.
  3. Make a Telegram group "EA operator" with the VPS bot. Put its chat id as `OPERATOR_TELEGRAM_CHAT_ID` in the VPS `.env`.
- **What waits:** only the drill. Alerts go nowhere until step 3 is done.
- **Added:** 2026-11-15.
