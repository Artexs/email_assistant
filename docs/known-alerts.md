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

### `mailbox:seed and mailbox:audit CLI > seed exits 1 … ^ this test timed out after 5000ms.`

- **First seen:** 2026-11-07
- **Source:** CI `bun run test:int`, `apps/server/test/integration/mail-seed.test.ts` (runs 42414616787 on `master`, 42417654598 on PR #1).
- **Cause:** the test starts six CLI processes one after the other. Their sum is near the 5 s default test timeout (3.9 s locally) and above it on a CI runner.
- **Fix:** the test has its own timeout of 30 s (`tasks/done/flaky-mail-seed-cli-test.md`). Local run: 3.9 s. It failed in 4 of 6 CI runs on 2026-11-07, so a re-run is not a fix.
- **Status:** fixed

### `job:run: TELEGRAM_BOT_TOKEN is empty`

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/scripts/job-run.ts` (`[job-run]`, level `error`, exit code 1).
- **Cause:** `bun run job:run --name channels.notifier` ran with no `TELEGRAM_BOT_TOKEN` in the environment. The notifier cannot send without the bot token.
- **Fix:** Set `TELEGRAM_BOT_TOKEN` in the `.env` of that environment (only the user edits `.env`), then run the command again. The other jobs (`actions.expiry`, `delegation.chaser`) need no token.
- **Status:** won't fix (expected behaviour)

### `notice send_result queued: outbox <id>`

- **First seen:** 2026-11-07 (S4 code; not seen live, the dev run (stage 19) and the VPS runs (stages 22, 23) are open)
- **Source:** `apps/server/src/modules/channels/notices.ts` (`[channels]`, level `info`).
- **Cause:** A send ended (`applied`, `failed`, `expired` or `rejected`) and the notice job queued one result message for each linked owner. The dedup key is `send_result:<action id>`, and `actions.result_notified_at` is set in the same transaction.
- **Fix:** No action for the line. Read the message in Telegram; the meaning of each text is in `deploy/README.md`, "Approvals and sends". The same line exists for the kinds `approval_set` and `delegation_answered`.
- **Status:** won't fix (expected behaviour)

### `notice approval queued: outbox <id>`

- **First seen:** 2026-11-07 (S4 code; not seen live, the dev run (stage 19) and the VPS runs (stages 22, 23) are open)
- **Source:** `apps/server/src/modules/channels/notices.ts` (`[channels]`, level `info`).
- **Cause:** A send is `awaiting_approval`, its draft is `applied` and the mailbox is `active`, so the notice job queued one approval request for each linked owner. The dedup key is `approval:<action id>`; `actions.notified_at` is set in the same transaction. The 48-hour approval time counts from `notified_at`.
- **Fix:** No action. If no request arrives in Telegram, check that an owner is linked (`telegram:link`) and that the draft is `applied`.
- **Status:** won't fix (expected behaviour)

### `chaser <mailboxId>: skipped settings`

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/delegation/chaser.ts` (`[delegation]`, level `info`; once per mailbox and process start). The same file writes `chaser <mailboxId>: skipped gate` once, when the first tick comes before 07:30 local time or after the run of the day.
- **Cause:** The mailbox is not in mode `assist`, or its switch `create_draft` is off, or the settings changed during the run (the chaser compares the settings version). The chaser makes no reminder for this mailbox.
- **Fix:** No action if you want no reminders. To get them: `mailbox:settings mode --mode assist` and `mailbox:settings switch --name create_draft --value on` (`deploy/README.md`, "Assist mode"). `skipped gate` is normal.
- **Status:** won't fix (expected behaviour)

### `chaser <mailboxId>: due <n>, overdue <o>, reminders <r>`

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/delegation/chaser.ts` (`[delegation]`, level `info`; once per mailbox and day, only when `<n>` > 0).
- **Cause:** The daily chaser run found `<n>` delegations past their due date. It marked `<o>` of them `overdue` and planned `<r>` reminders (draft + send, `awaiting_approval`). The owners get one approval message for the set.
- **Fix:** No action. Tap 📤 Send all or ✖️ Skip all in Telegram. A reminder never goes out without a tap.
- **Status:** won't fix (expected behaviour)

### `notice <kind> <id>: skipped: <error>`

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/channels/notices.ts` (`[channels]`, level `warn`; `<kind>` is `approval`, `approval_set`, `send_result` or `delegation_answered`). Once per process and row.
- **Cause:** The notice job could not build the message for one row (for example a draft payload that does not parse, a missing mailbox, or a missing organization). It skips that row and goes on with the others. The row keeps failing on every tick until someone fixes it, and the owner gets no message for it.
- **Fix:** Find the row with a read-only query (`$C exec db psql -U postgres -d email_assistant -c "<sql>"`):
  `approval`: `select id, status, notified_at, payload->>'kind' from actions where id = '<id>';`
  `approval_set`: `select id, status, notified_at from actions where payload->>'set_id' = '<id>';`
  `send_result`: `select id, status, status_reason, result_notified_at from actions where id = '<id>';`
  `delegation_answered`: `select id, status, answered_notified_at from delegations where id = '<id>';`
  Read `<error>` and the row, and fix the cause (a bug: file it with the action type, never with the payload). To stop the retries you can set `notified_at` (approval), `result_notified_at` (send_result) or `answered_notified_at` (delegation_answered) by hand: this writes to the database, so do it only after the user says go.
- **Status:** investigating

### `expiry <mailboxId>: expired <n> (timeout <t>, draft_missing <d>, not_notified <u>, held_timeout <h>)`

- **First seen:** 2026-11-07 (S4 code; not seen live: the hourly timing is checked in the dev run, stage 19, which is open)
- **Source:** `apps/server/src/modules/actions/expiry.ts` (`[actions]`, level `info`; job `actions.expiry`, every hour).
- **Cause:** The job closed `<n>` sends as `expired`: `timeout` (48 h after the approval request), `draft_missing` (its draft failed or was removed), `not_notified` (no request went out within 7 days) and `held_timeout` (approved, but held for 48 h after the tap). Each gives the owners a result notice.
- **Fix:** No action for `timeout`. A high `held_timeout` means sends were held: check `SEND_SCOPE`, a paused mailbox or a login error. A high `not_notified` means no owner is linked. The line `expiry <mailboxId> failed: <label>` (level `error`) means one mailbox failed; the next hour tries again.
- **Status:** won't fix (expected behaviour)

### `committer <mailboxId>: SEND_SCOPE=<kind>, <n> approved sends wait`

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/actions/committer.ts` (`[actions]`, level `info`; once per mailbox and process start).
- **Cause:** `SEND_SCOPE` is `off` (the default), or `self` with recipients that are not in `SEND_TEST_ADDRESSES`, or `all` for another mailbox. `<n>` sends are `approved` with an applied draft, and the scope does not admit them. They stay `approved`.
- **Fix:** No action if you want no sends. To send: set `SEND_SCOPE` (and `SEND_TEST_ADDRESSES`) in the `.env` and restart the server (`deploy/README.md`, "Approvals and sends"). Held sends expire 48 h after the tap (`held_timeout`).
- **Status:** won't fix (expected behaviour)

### `action <id>: failed hard_error` (a `create_draft` row)

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/actions/drafts.ts` (`[actions]`, level `warn`). A draft with a bad payload gives `action <id>: failed bad_payload` from the same file.
- **Cause:** The draft APPEND (or its recovery, or the removal of a draft) failed with a hard error three times. The draft is `failed`, its open sends expire (`draft_missing`) and the owners get a notice. For a reverse row (draft removal) the notice says that the draft stays in Drafts.
- **Fix:** Read the audit row `action.failed` (`attempts`, `error`) and run `bun run mailbox:check`. Check that the Drafts folder exists and the mailbox is not full. For a reverse row, delete the draft by hand in the mail client. For `bad_payload`, file a bug with the action type (never with the payload).
- **Status:** investigating

### `action <id>: sent copy failed: <Class code>`

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/actions/send.ts` (`[actions]`, level `warn`).
- **Cause:** The mail went out (the send is `applied`), but the copy to `Wysłane` failed: the locate or the APPEND gave an error. `provider_result.sent_copy` is `failed`, and the audit row `action.sent_copy_failed` holds the error label. The owners read "No copy in Sent".
- **Fix:** No action for the mail: it was sent. Add the copy by hand if you need it. If it repeats, check the `Sent` folder with `bun run mailbox:check`.
- **Status:** investigating

### `action <id>: failed outcome_unknown (stage <s>, code <c>)`

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/actions/send.ts` (`[actions]`, level `warn`).
- **Cause:** The system cannot tell if the mail went out. Either the SMTP error had stage `unknown` (a connection that broke during or after the content, or an error that is not a typed SMTP error), or the process stopped while the send was `applying` and the recovery found no copy in `Wysłane`. The row is `failed`, the delegation is `cancelled` (`outcome_unknown`), and the system does not send again by itself.
- **Fix:** Look in `Wysłane` and ask the recipient. If the mail did not go out, tap 📤 Send again in the result notice. If it went out, do nothing (the delegation stays `cancelled`: follow-up `tasks/planned/delegation-went-out-button.md`).
- **Status:** investigating

### `action <id>: failed smtp_error (stage <s>, code <c>)`

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/actions/send.ts` (`[actions]`, level `warn`).
- **Cause:** One of three: a hard error before the content (`connect`, `login` or `envelope`) three times; a 4xx or another non-5xx error after the content (`content`: the server may have the mail, so the system does not retry); or the mail could not be built three times (`compose`). The row is `failed` and the owners get a notice with 📤 Send again.
- **Fix:** For `content`, look in `Wysłane` and ask the recipient before you tap Send again. Otherwise check `/status` and `bun run mailbox:check`, fix the cause, then tap Send again. The line `action <id>: send retry (stage <s>, code <c>)` (level `warn`) is a try that will repeat in 5 minutes; a soft error does not count.
- **Status:** investigating

### `action <id>: failed smtp_rejected (stage <s>, code <n>)`

- **First seen:** 2026-11-07 (S4 code; not seen live)
- **Source:** `apps/server/src/modules/actions/send.ts` (`[actions]`, level `warn`).
- **Cause:** The mail server refused the mail with a 5xx reply, at the envelope (`MAIL FROM`, `RCPT TO`) or after the content. `<s>` is `envelope` or `content`, `<n>` is the reply code. The row is `failed`. The draft stays in Drafts and the delegation is `cancelled`. There is no Send again button, because the address or the mail is wrong.
- **Fix:** Check the delegate address (`delegates:list`). Replace it with `delegates:disable` and `delegates:add`. The system does not plan the mail again; send it by hand from the draft if you need it.
- **Status:** investigating

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
- **Cause:** The mailbox refused the login (IMAP, or since S4 the SMTP login of a send). The committer set the mailbox status to `auth_error`; the sync notice tells the user. The claimed actions go back to `ready`; an approved send goes back to `approved` with no count and no mail sent.
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
- **Cause:** `ACTIONS_SCOPE` is `off` (the default), so the committer applies no mailbox change. <n> mailbox actions are `ready` and wait. The count has `move`, `mark_read` and `flag` actions, and since S4 (M10) also `create_draft` rows (drafts wait for the same scope). `save_summary` is not counted.
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

### `[mailbox-audit] inbox=<n> stored=<m> missing=0 duplicates=<k> cross=<c>` (exit 2)

- **First seen:** 2026-11-05 (S1a 48-hour test, `~/ea-logs/audit.log` on the VPS)
- **Source:** `bun run mailbox:audit` (`apps/server/src/modules/mail/tools.ts`, `auditMailbox`).
- **Cause:** "duplicates" counts stored INBOX rows whose `(Message-ID, content hash)` key is not in the IMAP INBOX now. The sync never deletes rows, so a mail that the user deletes or moves out of INBOX after the sync stored it counts as a duplicate. On 2026-11-05 both rows were real mails deleted from the mailbox (not found in any folder).
- **Fix:** Check for a real double store first: `SELECT message_id_header, content_hash, count(*) FROM emails WHERE mailbox_id = '<MB>' AND folder = 'INBOX' AND received_at >= '<since>' GROUP BY 1, 2 HAVING count(*) > 1;`. 0 rows and `missing=0` = no problem. To name the rows, compare the `fetchSince` keys with `listFolderEmailKeys` in a one-off read-only script. Since the sort-folder sync the tool also prints one `folder=<key> …` line per enabled synced folder. A `cross` count is no problem: it counts mail that has a row in another synced folder (the mail is not lost; independent review m10, `tasks/active/sync-sort-folders.md`).
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
- **Cause:** Interia sends no `UIDNEXT` in the SELECT reply. The old `inboxStatus()` returned `NaN`, and the cursor update failed in Postgres. (Later finding, 2026-11-08: STATUS gives `UIDNEXT 1` for every folder, which is wrong too.)
- **Fix:** the status call (`folderStatus()` in `apps/server/src/modules/mail/imap/client.ts`; the sort-folder sync removed `inboxStatus`, `searchInboxSince` and `fetchByUids`) asks `STATUS (UIDNEXT)`, then uses the highest UID + 1, then 1. With STATUS at 1, the fix is D4 of `tasks/active/sync-sort-folders.md` (cursor from the highest UID + 1, per folder).
  A missing `UIDVALIDITY` now gives `IMAP INBOX gave no valid UIDVALIDITY`.
- **Status:** fixed

### `This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.`

- **First seen:** 2026-11-02
- **Source:** Gemini API, `cd backend && bun run gemini:test` (model `gemini-3.8-flash`, free tier). HTTP 503, status `UNAVAILABLE`.
- **Cause:** Google-side overload of the model. Not a key or config error (the key was accepted). One call hung for more than 90 s before the error.
- **Fix:** retry later. In the app: `platform/llm.ts` treats 503 as a soft error (wait with backoff, no count toward the 3 tries) and uses a 30 s timeout (ADR 0012). Optional fallback model in config.
- **Status:** workaround
- **Update 2026-11-05:** the script is now `apps/server/src/scripts/gemini-check.ts`. Run `bun run gemini:test` from the repo root. It prints `Request failed: LlmSoftError http_503` (no raw body). In the worker, a 503 pauses the LLM client 5 → 60 min (architecture §4.1 rule 7).
