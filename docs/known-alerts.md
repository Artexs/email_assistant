# Known alerts

Alerts we have already diagnosed. Before you diagnose an alert, search this file for its text.

When you find the cause of a new alert, add an entry below (newest first).

Status values: `fixed` · `fix pending` · `workaround` · `won't fix` · `investigating`

## Template

### `<exact alert text, or its stable part>`

- **First seen:** YYYY-MM-DD
- **Source:** which module / source / command raised it (log line, monitor)
- **Cause:** what actually went wrong
- **Fix:** what was changed (commit hash, file) or what to do when it fires
- **Status:** fixed / fix pending / workaround / won't fix / investigating

---

### `Failed to copyto: failed to HEAD for download: Unknown 401`

- **First seen:** 2026-11-03
- **Source:** `deploy/backup.sh` on the VPS, `rclone copyto` to the B2 bucket.
- **Cause:** the B2 key can only write. Before the upload, rclone sends a HEAD request to check the target file, and B2 refuses it.
  The apt rclone (1.53) fails earlier; the VPS uses rclone 1.75.2 at `~/bin/rclone`.
- **Fix:** `rclone copyto --no-check-dest` in `deploy/backup.sh`. Cron `PATH` starts with `/home/serwer/bin` (`notes/2026-11-03-pilot-vps.md`).
- **Status:** fixed

### `sync <mailbox id> failed: invalid input syntax for type bigint: "NaN"`

- **First seen:** 2026-11-03
- **Source:** `[mail]` sync job, first sync of the Interia mailbox.
- **Cause:** Interia sends no `UIDNEXT` in the SELECT reply. `inboxStatus()` returned `NaN`, and the cursor update failed in Postgres.
- **Fix:** `inboxStatus()` in `apps/server/src/modules/mail/imap/client.ts` asks `STATUS (UIDNEXT)`, then uses the highest UID + 1, then 1.
  A missing `UIDVALIDITY` now gives `IMAP INBOX gave no valid UIDVALIDITY`.
- **Status:** fixed

### `This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.`

- **First seen:** 2026-11-02
- **Source:** Gemini API, `cd backend && bun run gemini:test` (model `gemini-3.8-flash`, free tier). HTTP 503, status `UNAVAILABLE`.
- **Cause:** Google-side overload of the model. Not a key or config error (the key was accepted). One call hung for more than 90 s before the error.
- **Fix:** retry later. In the app: `platform/llm.ts` treats 503 as a soft error (wait with backoff, no count toward the 3 tries) and uses a 30 s timeout (ADR 0012). Optional fallback model in config.
- **Status:** workaround
