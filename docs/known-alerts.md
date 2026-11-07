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

### `mailbox:settings: refused: <category> did not pass go/no-go (use --force to set auto on anyway)`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/scripts/mailbox-settings.ts` (`[mailbox-settings]`, level `error`, exit code 2).
- **Cause:** A command `auto <category> on` named a category whose S1b go/no-go row is not `go` (precision below 0.98 or fewer than 30 kept labels). The gate refuses the change.
- **Fix:** No action if you did not want `auto` on. Read the line `go/no-go <category>: …` before it. To set `auto` anyway, run the command again with `--force`; the audit row records `forced`.
- **Status:** won't fix (expected behaviour)

### `notice action_failed queued: outbox <id>`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/channels/notices.ts` (`[channels]`, level `info`).
- **Cause:** An action became `failed` and the notice job queued one `action_failed` message for the user. The text says which action failed and why. The dedup key is `action_failed:<action id>`, so one action gives one notice.
- **Fix:** No action for the alert. Read the audit row `action.failed` of the action (`reason_code`). The user decides in the mailbox. See `deploy/README.md`, "Assist mode".
- **Status:** won't fix (expected behaviour)

### `returned <mailboxId>: processed <n>`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/triage/returned.ts` (`[triage]`, level `info`; job `triage.returned`, every 15 s).
- **Cause:** The job processed <n> mails that the sync marked as returned to INBOX (`emails.returned_at`). Only some get a feedback row: `imap_move` for a user move back; none after an Undo or for an `unsure` mail.
- **Fix:** No action. A line `returned <id>: <label>` at level `error` means one row failed; read the label and check the DB.
- **Status:** won't fix (expected behaviour)

### `expired <n> ready actions`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/scripts/mailbox-settings.ts` (`[mailbox-settings]`, level `info`; the commands `expire-ready` and every gate-closing setter).
- **Cause:** The CLI closed <n> `ready` mailbox actions as `expired`. A gate change (`mode shadow`, `auto off`, `switch off`, `mode assist` without `--keep-switches` when it turns a switch off) does this in the same transaction. The line shows only when a gate closed or `<n>` > 0. `expire-ready` does it on request.
- **Fix:** No action. Run `expire-ready` before you set `ACTIONS_SCOPE=all`, so that old `ready` rows do not apply. The next line shows how many `ready` mailbox actions are left.
- **Status:** won't fix (expected behaviour)

### `sync <mailboxId> returned below cursor: list hit the limit <n>`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/mail/sync.ts` (`[mail]`, level `warn`).
- **Cause:** The list of mails moved in the last 7 days has 500 rows (`RETURN_CHECK_LIMIT`). The check looks at the newest 500 only, so older moved mails are not checked for a return.
- **Fix:** Check how many mails the system moved in 7 days. If the number is real, raise the limit in a task. No data is lost: the check only misses returns of the oldest rows.
- **Status:** investigating

### `sync <mailboxId> returned below cursor: checked <n>, returned <m>, copies <c>`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/mail/sync.ts` (`[mail]`, level `info`; one line per sync that has moved mails).
- **Cause:** <n> mails moved in the last 7 days were looked up in INBOX below the UID cursor, <m> of them came back (Interia keeps the UID). `copies` > 0 means a copy of a moved mail sits below the cursor while the original is still in its folder. The same copy counts again on every sync for 7 days. The debug line `sync <mailboxId> copy below cursor: email <id>` names the row.
- **Fix:** `returned` > 0 is normal after a user move back. `copies` > 0: no loss, but the system does not store or triage the copy. Switch the log level to debug to see the rows. Follow-up: `tasks/planned/copy-below-cursor.md`.
- **Status:** investigating

### `committer <mailboxId>: <Class code>; the next tick tries again`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/committer.ts` (`[actions]`, level `warn`).
- **Cause:** Opening the mailbox failed with a soft error (network, timeout, server busy). The claimed actions go back to `ready` and no try counts.
- **Fix:** No action. The next tick (15 s) tries again. If it repeats for hours, run `bun run mailbox:check` and check the pilot mailbox and the network.
- **Status:** won't fix (expected behaviour)

### `committer <mailboxId>: login failed, status is now auth_error`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/committer.ts` (`[actions]`, level `warn`).
- **Cause:** The mailbox refused the login. The committer set the mailbox status to `auth_error`; the sync notice tells the user. The claimed actions go back to `ready`.
- **Fix:** Fix the secret (password or app password) with `bun run mailbox:password` and set the mailbox to `active` again. Actions wait and apply later if they are younger than 24 h and the mail is younger than 7 days; older ones expire.
- **Status:** investigating

### `action <id>: <Class code>, try <n> of 3`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/apply.ts` (`[actions]`, level `warn`).
- **Cause:** An IMAP call failed. A soft error (network, timeout) waits 5 minutes and does not count as a try. A hard error waits 5 minutes and counts. After the third hard error the action is `failed` (`hard_error`).
- **Fix:** No action for try 1 and 2. Read the `last_error` column of the action. For a repeat, check the mailbox with `bun run mailbox:check`.
- **Status:** won't fix (expected behaviour)

### `action <id>: failed bad_payload`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/apply.ts` (`[actions]`, level `warn`).
- **Cause:** The payload of the action row is wrong (for example a missing folder key or UID). This is a bug in the code that planned the action, not a mailbox problem. The action is `failed` at once.
- **Fix:** Read the audit row `action.failed` and the `payload` of the action. File a bug with the action type. Never put the payload in the bug text if it holds mail data.
- **Status:** investigating

### `action <id>: failed hard_error`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/apply.ts` (`[actions]`, level `warn`).
- **Cause:** The third hard error in a row for the same action. The action is `failed`, the audit row `action.failed` has `reason_code` `hard_error` and the error label. The user gets an `action_failed` notice.
- **Fix:** Read the audit data (`attempts`, `error`). Check the mailbox with `bun run mailbox:check`. The mail stays where it was; the user can move it by hand.
- **Status:** investigating

### `action <id>: failed mail_not_found`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/apply.ts` (`[actions]`, level `warn`).
- **Cause:** The locate did not find the mail in its folder (the user moved or deleted it). The action is `failed` at once, without retries. An original action sends no notice; a reverse (Undo) action does.
- **Fix:** No action. The user changed the mailbox on their own. If it happens for mail that the user did not touch, check the identity locate (`locate.ts`) and the folder facts in `notes/2026-11-07-assist-actions-facts.md`.
- **Status:** won't fix (expected behaviour)

### `committer: ACTIONS_SCOPE=off, <n> mailbox actions wait in mailbox <id>`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/committer.ts` (`[actions]`, level `info`; once per mailbox and process start).
- **Cause:** `ACTIONS_SCOPE` is `off` (the default), so the committer applies no mailbox change. <n> mailbox actions are `ready` and wait. The count has `move`, `mark_read` and `flag` actions. `save_summary` is not counted.
- **Fix:** No action if you want no changes. To apply them: set `ACTIONS_SCOPE=synthetic` or `all` in the `.env`, run `expire-ready` first when the rows are old (`deploy/README.md`, "Assist mode"), and restart the server.
- **Status:** won't fix (expected behaviour)

### `committer <mailboxId>: expired <n> stale actions`

- **First seen:** 2026-11-07 (S3 code; not seen live, the dev run with the phone (stage 16) and the VPS deploy (stage 19) are open)
- **Source:** `apps/server/src/modules/actions/committer.ts` (`[actions]`, level `warn`).
- **Cause:** The committer found <n> `ready` actions that waited longer than 24 hours (D21) and closed them as `expired`. This happens after the scope was `off`, the mailbox had an `auth_error` or the server was down.
- **Fix:** No action. The mail stays in INBOX. If it repeats, find why the committer did not apply the actions in time (scope, `auth_error`, a pause).
- **Status:** won't fix (expected behaviour)

### `callback failed: <label>`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/telegram/bot.ts` (`[telegram]`, level `error`).
- **Cause:** The handler of a button tap threw an error (a database error or a bug). The label is `GrammyError <method> <code>`, `HttpError <method>` or the `describeError` text. The user sees "Something went wrong".
- **Fix:** Read the label. A database label: check the DB and the migration state. Repeat the tap. If it repeats, file a bug with the label (never with a message text).
- **Status:** investigating

### `digest for org <id> user <id> failed: <label>`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/digest-job.ts` (`[channels]`, level `error`).
- **Cause:** Building or saving the digest of one member failed (for example a database error or a missing organization). The other members continue. The slot stays open, so the next minute tries again.
- **Fix:** Read the label. If it repeats every minute, check the DB and the member's `digest_times` (`bun run digest:times`). A late slot older than 6 hours is skipped.
- **Status:** investigating

### `notices for org <id> failed: <label>`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/notices.ts` (`[channels]`, level `error`).
- **Cause:** Notice detection for one organization failed (database error or missing organization). The other organizations continue. The next tick (15 s) tries again.
- **Fix:** Read the label. If it repeats, check the DB and the organization row.
- **Status:** investigating

### `outbox <id>: lost the claim after the send`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/sender.ts` (`[channels]`, level `warn`).
- **Cause:** The message was sent, but the row was no longer `sending` with the same lock when the sender marked it `sent`. Another run reclaimed the row (stale claim) or the row was deleted (cascade).
- **Fix:** Check the outbox row `<id>` and the other log lines for the same id. A duplicate message is possible (delivery is at least once). No action if it is rare.
- **Status:** won't fix (expected behaviour, rare)

### `outbox <id>: sent again after a stale send (a duplicate is possible)`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/sender.ts` (`[channels]`, level `warn`).
- **Cause:** A row stayed `sending` for more than 5 minutes (the process died, or the DB commit after the send failed), so the next claim sends it again. The user can get the message twice.
- **Fix:** No action. If it repeats, look for crashes or DB errors around the first send of the row.
- **Status:** won't fix (expected behaviour)

### `outbox <id>: Telegram refused the message (<code>)`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/sender.ts` (`[channels]`, level `error`). Code: `telegram_400`, `message_too_long` or `button_data_too_long`.
- **Cause:** Telegram or the adapter guard refused the text or the buttons (400). The row becomes `failed` / `bad_request` and is never sent again.
- **Fix:** Read the row (`text` length, `buttons`). A `message_too_long` or `button_data_too_long` code is a bug in the text builder: file it with the row id.
- **Status:** investigating

### `outbox <id>: the user blocked the bot (403)`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/sender.ts` (`[channels]`, level `warn`).
- **Cause:** The member blocked the bot or deleted the chat. The row becomes `failed` / `blocked`.
- **Fix:** Ask the member to unblock the bot and send `/start`. If the chat is gone, make a new link (`bun run telegram:link`).
- **Status:** won't fix (expected behaviour)

### `outbox <id>: <code>; sending paused for <s> s` (also `outbox <id>: rate limited; sending paused for <s> s`)

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/sender.ts` (`[channels]`, level `warn`). The text `outbox <id>: rate limited; sending paused for <s> s` is the 429 case (waits `retry_after`). The codes `telegram_network` and `telegram_500` (and other 5xx) are soft errors (backoff 30 s doubling to 15 min).
- **Cause:** Telegram limited the bot (429) or was not reachable (network error, HTTP 5xx). The sender pauses and tries the same rows later. After 5 other errors a row becomes `failed` / `too_many_errors`.
- **Fix:** No action for short pauses. For a long one, check the network of the host and https://core.telegram.org reachability. Rows older than 24 hours become `failed` / `expired`.
- **Status:** won't fix (expected behaviour)

### `telegram token rejected (401): check TELEGRAM_BOT_TOKEN; sending paused for 10 min`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/sender.ts` (`[channels]`, level `error`).
- **Cause:** Telegram answered 401 to a send: the token in `.env` is wrong, revoked or from another bot. The sender pauses for 10 minutes and tries again.
- **Fix:** Check the token with `bun run telegram:check`. Fix `TELEGRAM_BOT_TOKEN` in `.env` (the user edits it) and restart the server.
- **Status:** fix pending (user action when it fires)

### `telegram: setMyCommands failed: <label>`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/telegram/polling.ts` (`[telegram]`, level `warn`).
- **Cause:** The server could not set the command list at the start (network error or Telegram error). Polling goes on; only the `/` menu in the app is missing or old.
- **Fix:** No action. The next start sets the list again. If it repeats with the label `GrammyError setMyCommands 401`, fix the token.
- **Status:** won't fix (expected behaviour)

### `telegram: polling failed: <label>; next try in <n> min`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/telegram/polling.ts` (`[telegram]`, level `error`).
- **Cause:** `bot.start` failed with an error other than 401 or 409 (network down, Telegram 5xx). The server tries again after 1, 2, 4 … at most 30 minutes. The count resets after a good `getUpdates`.
- **Fix:** Check the network of the host. No action if the next try works. Mail sync and the DB are not affected.
- **Status:** won't fix (expected behaviour)

### `telegram: another process polls this bot token (409); dev and pilot must use different bots (ADR 0005); next try in <n> min`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/telegram/polling.ts` (`[telegram]`, level `error`).
- **Cause:** Telegram allows one update consumer per token. A second process (for example the Mac with the pilot token, or a second server container) polls the same bot (409). The server tries again after 1, 2, 4 … at most 30 minutes.
- **Fix:** Find and stop the other process. Use the dev bot on the Mac and the pilot bot on the VPS. The server takes over by itself at the next try.
- **Status:** workaround (stop the other poller)

### `telegram: the bot token was rejected (401): check TELEGRAM_BOT_TOKEN; polling stopped`

- **First seen:** 2026-11-06 (S2 code; not seen live in the stage 21 dev run or the stage 23 pilot run, 2026-11-07)
- **Source:** `apps/server/src/modules/channels/telegram/polling.ts` (`[telegram]`, level `error`).
- **Cause:** Telegram answered 401 to `getMe` or `getUpdates`: the token is wrong, revoked or empty-looking. Polling stops and does not retry.
- **Fix:** Check the token with `bun run telegram:check`. Fix `TELEGRAM_BOT_TOKEN` in `.env` (the user edits it) and restart the server. Never print the token.
- **Status:** fix pending (user action when it fires)

### `[mailbox-audit] inbox=<n> stored=<m> missing=0 duplicates=<k>` (exit 2)

- **First seen:** 2026-11-05 (S1a 48-hour test, `~/ea-logs/audit.log` on the VPS)
- **Source:** `bun run mailbox:audit` (`apps/server/src/modules/mail/tools.ts`, `auditMailbox`).
- **Cause:** "duplicates" counts stored INBOX rows whose `(Message-ID, content hash)` key is not in the IMAP INBOX now. The sync never deletes rows, so a mail that the user deletes or moves out of INBOX after the sync stored it counts as a duplicate. On 2026-11-05 both rows were real mails deleted from the mailbox (not found in any folder).
- **Fix:** Check for a real double store first: `SELECT message_id_header, content_hash, count(*) FROM emails WHERE mailbox_id = '<MB>' AND folder = 'INBOX' AND received_at >= '<since>' GROUP BY 1, 2 HAVING count(*) > 1;`. 0 rows and `missing=0` = no problem. To name the rows, compare the `fetchSince` keys with `listInboxEmailKeys` in a one-off read-only script.
- **Status:** won't fix (audit limit; expected after a delete)

### `daily LLM cap reached for mailbox <mailboxId>: <cap> calls since <dayStart> (America/Los_Angeles day); mail waits until <time>`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/jobs.ts`, `[triage]` worker. One warning per mailbox and quota day, per process (a restart logs it again).
- **Cause:** The mailbox used `LLM_DAILY_CAP` LLM call attempts (`audit_log` event `llm.call`, failed calls too) since the start of the Pacific day.
- **Fix:** No action needed. The mail goes back to `pending` and waits until the next quota day. If it fires too early, check failed `llm.call` rows (503 retries count) and read `notes/2026-11-05-gemini-free-tier-triage.md`. Change `LLM_DAILY_CAP` only with the real RPD.
- **Status:** won't fix (expected behaviour)

### `LLM soft error <code>: triage paused for <n> min, until <time>`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/pause.ts` (`[triage]`). Codes: `http_429`, `http_500`, `http_502`, `http_503`, `http_504`, `timeout`, `network`.
- **Cause:** Google quota or overload, or no network connection to Google (code `network`: refused, reset or DNS failure). Not the mail. The LLM client of the process pauses with a backoff of 5 → 60 min, in memory.
- **Fix:** Wait. The mail goes back to `pending` with `next_attempt_at` = the pause end and no try count. A restart clears the pause. Often seen with `gemini-3.8-flash` (503) and on Flash-Lite at busy times (`notes/2026-11-05-gemini-free-tier-triage.md`).
- **Status:** workaround

### `LLM config error <code>: check GEMINI_API_KEY, GEMINI_MODEL_CLASSIFIER and the Google project (billing, region); triage paused for <n> min, until <time>`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/pause.ts` (`[triage]`). Codes: `http_401`, `http_402`, `http_403`, `http_404`, `http_400_key`, `http_400_precondition`.
- **Cause:** A bad or missing key, no access or billing, a wrong region, or an unknown model name. Retrying the mail does not help.
- **Fix:** Check `GEMINI_API_KEY`, `GEMINI_MODEL_CLASSIFIER` and the Google project. Then restart the server. The pause uses the same backoff as a soft error and the mail gets no try count.
- **Status:** investigating (per case)

### `triage <mailboxId>: no mailbox_settings row, mailbox skipped`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/jobs.ts`, `[triage]` worker. One warning per mailbox and process.
- **Cause:** The mailbox has no `mailbox_settings` row, so the worker has no mode, tool switches or category policy for it.
- **Fix:** Create the settings row for the mailbox (default settings). Restart to log the line again. The worker skips the mailbox until the row exists.
- **Status:** workaround

### `triage <mailboxId> failed: <Class> <code>`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/jobs.ts`, error handler of one mailbox. `<Class> <code>` comes from `describeError`: the class name, then the `code` if the error has one (no brackets), never the message text.
- **Cause:** An error outside the LLM call: thread read, save, DB or a bug. It stopped this mailbox for this run.
- **Fix:** The mail in work counts one try and waits 5 minutes. At 3 tries it ends as `unsure` / `triage_error`. Later claimed mail goes back with no count. Look at the class and code, then at the DB and server logs.
- **Status:** investigating (per case)

### `triage failed: <Class> <code>`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/jobs.ts`, outer handler of the run (for example the mailbox list failed).
- **Cause:** An error outside the per-mailbox handler, for example in `listSyncTargets` or the DB connection.
- **Fix:** The next run tries again. If it repeats, check the DB connection and the server log.
- **Status:** investigating (per case)

### `triage <emailId>: lost the claim`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/service.ts`, `[triage]`, on save of a triaged or skipped (`too_old`) mail. Warning.
- **Cause:** The `locked_at` of the mail changed during the work: a stale take-back by a later run (claim older than 5 min), or a slow LLM call. The save did nothing.
- **Fix:** No action. The run that holds the claim triages the mail. If it repeats often, check for two servers on one DB or very slow LLM calls.
- **Status:** won't fix (expected behaviour)

### `triage <mailboxId>: release failed: <Class> <code>`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/jobs.ts`, when it puts claimed mail back to `pending`.
- **Cause:** The DB update failed (connection or lock). The mail stays `processing` with its claim.
- **Fix:** The mail becomes claimable after 5 minutes (stale claim). That take-back counts one attempt. Check the DB.
- **Status:** investigating (per case)

### `triage <mailboxId>: triage_error save failed: <Class> <code>`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/jobs.ts`, when the third hard error should save `unsure` / `triage_error`.
- **Cause:** The DB write of the `triage_error` result failed.
- **Fix:** The code releases the mail with a 5-minute wait and a count. It tries again later. Check the DB.
- **Status:** investigating (per case)

### `triage <emailId>: llm.call audit write failed: <Class> <code>`

- **First seen:** 2026-11-05
- **Source:** `apps/server/src/modules/triage/service.ts`, after a failed LLM call. Warning.
- **Cause:** The `audit_log` row for the failed call could not be written. The error rules still run, but the call is missing from the daily cap count.
- **Fix:** Check the DB. The cap may count too few calls until it works.
- **Status:** investigating (per case)

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
- **Update 2026-11-05:** the script is now `apps/server/src/scripts/gemini-check.ts`. Run `bun run gemini:test` from the repo root. It prints `Request failed: LlmSoftError http_503` (no raw body). In the worker, a 503 pauses the LLM client 5 → 60 min (architecture §4.1 rule 7).
