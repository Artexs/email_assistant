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

## 3. The backup restore drill (F114 stage 09 part C)

- **Why:** the drill proves that a backup really restores. It needs your backup key; no agent may hold it.
- **What to do:**
  1. Find the `age` key file that decrypts the backups (`*.dump.age`). Tell the coordinator its path on this PC.
  2. Make a Healthchecks.io check "backup" (period 1 day, grace 2 h). Put its URL as `BACKUP_PING_URL` in `deploy/backup.env` on the VPS.
  3. Make a Telegram group "EA operator" with the VPS bot. Put its chat id as `OPERATOR_TELEGRAM_CHAT_ID` in the VPS `.env`.
- **What waits:** only the drill. Alerts go nowhere until step 3 is done.
- **Added:** 2026-11-15.

## 4. Turn on reading of your Sent mail (F104 stage 13, flag `sent_sync`)

- **Why:** the assistant then sees which mail you answered. Open loops and the "no sent mail seen for 7 days" notice need it. The code is on the VPS since v0.2.0; the flag is off.
- **Before it:** the coordinator adds a time limit to the Sent read (stage 13a, so a slow Sent folder cannot delay the inbox sync) and ships it in release v0.2.1. It does not turn the flag on without your word.
- **What to do (about 2 minutes):**
  1. Tell the coordinator: "turn on sent_sync for the pilot". It turns the flag on for your organization only.
  2. In the panel: Settings → your mailbox → "Sent mail" → turn on "Track my sent mail". The card says "The first read of Sent runs at the next sync."
  3. Tell the coordinator "done". It checks the first read and writes the counts (no subjects, no addresses) in a note.
- **Undo:** turn the switch off in the panel (this deletes the stored sent mail), or tell the coordinator to turn the flag off.
- **What waits:** only F104 (the last stage). F116 open loops work without it, but see less.
- **Added:** 2026-11-16.

## Update 2026-11-19 (owner answers)

- Item 1 (F111 O2): the owner uses LM Studio, not Ollama. `localhost:1234` serves `bielik-11b-v3.1-instruct` and `gemma-3-12b-it`. Done: F111 stage 05 runs on it. No owner step left.
- Item 3 (F114 U1): the `age` key is on the PC at `~/.config/ea-backup/age-key.txt`. U1 done. U2 (Healthchecks URL) and U3 (operator Telegram group) stay with the owner.

## 5. An old env copy holds values the live env lacks: keep or delete? (F108 stage 06)

- **Why:** an env copy on the VPS holds secrets in plain text. The rule is: no `.env` copy stays on the VPS. Three copies held only lines that the live env holds, and the coordinator deleted them. Two copies hold a value that the live env does not hold, so they stay until you decide.
- **The two copies** (in `~/email_assistant` on the VPS; key names only, never values):
  - `.env.bak-f069`: `OPENAI_API_KEY` differs, `WEB_TRUSTED_PROXIES` differs; all other keys equal the live env.
  - `.env.bak-s5e`: `OPENAI_API_KEY` differs; all other keys equal the live env.
- **What to do:** if the old OpenAI key is revoked or not needed, tell the coordinator "delete the old env copies". If you want to keep an old value, move it to a place outside the VPS (your password manager) first, then say the same.
- **Undo:** none after the delete. The live env does not change.
- **Added:** 2026-11-20.

## 6. Checks of the production checkpoint that need you (F108 stage 07, optional)

- **Why:** the test organization on the VPS went through invite, password, pause, resume and delete, and the pilot kept working. Some checks need things only you can give, so they are "not verified".
- **Not verified, and what each needs:**
  - Connect a mailbox to a test organization and see triage run, and the rule that mail from more than 24 hours before a resume is not triaged: a test mailbox that is not your pilot mailbox (owner step O2).
  - The Telegram answer "account paused" for a paused organization: a second Telegram account (owner step O2).
  - The backup objects in the Backblaze bucket (names and sizes) and the bucket lifecycle rule: a read-only bucket key as an `rclone` remote on this PC (owner step O1). The VPS key can only write.
- **What to do:** give the coordinator one of these, then say "run the F108 checks again". Each check uses a new test organization and deletes it at the end.
- **What waits:** nothing. F108 does not wait for them.
- **Added:** 2026-11-20.
