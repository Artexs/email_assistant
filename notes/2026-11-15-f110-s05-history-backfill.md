# F110 stage 05: history backfill and queue at connect (notes for stages 06, 07 and 25)

Code: `mail/sync.ts` (`backfillInbox`, `historyRefusalBeforeOpen`), `mail/tools.ts` (`backfillMailbox`, `BackfillDeps`), `mail/connect.ts` (`OnConnected`, `runOnConnected`), `trust/connect-hook.ts`, `trust/operator.ts`, `scripts/trust-history-check.ts`.

## What stage 06 must know

- `backfillMailbox(deps, ctx, mailboxId, { days: 30, now, purpose: "history" })` returns `{ kind: "done", result } | { kind: "refused", reason }`. Reasons: `window_too_long`, `org_suspended`, `never_synced`, `uidvalidity_changed`, `auth_refused`. Map: `never_synced` → wait 5 min, no attempt; `uidvalidity_changed` → `no_result` / `uidvalidity`; `auth_refused` → `no_result` / `auth_refused`; `org_suspended` → wait (no attempt); `window_too_long` cannot happen with 30 days. An empty window is `done` with `fetched` 0 (stage 06 maps it to `no_history`).
- The caller passes `oauthTokens` (from `mailOAuthRuntime(...).tokens`) in `deps`; without it an OAuth mailbox throws `oauth not wired` (an error, one attempt). `composition.test.ts` lists `modules/mail/tools.ts` as an `openMailboxProvider` caller for this reason. Wire `oauthTokens` in `main.ts` and add its line to the token-wiring test.
- A refusal that needs no login (window, suspended, never synced) opens no connection and asks no token. `auth_refused` is `MailAuthError` of the open (includes `protocolDisabled`); a network fault stays a thrown `SoftError` (the job counts an attempt).
- `CursorMovedError` (a `SoftError`): a regular sync that moves the cursor between the plan and the apply of one 50-mail chunk fails the run. Nothing of that chunk is stored; a repeat is cheap (stored mail is skipped without a content fetch). Stage 06 should treat it as a retry, not as a failure that burns one of three attempts (decision for stage 06; the race test shows both orders are safe).
- History mail is stored with `status = 'skipped'`, `skip_reason = 'history_check'` (`HISTORY_SKIP_REASON`), `backfilled_at` = run time. Only inserts are written: no `update_uid`, `returned` or `relocated`. Whatever reads `skipped` mail by reason: `reports/digest.ts` counts `email.skipped` audit rows (history writes none); `requeueTooOld` re-queues `history_check` for the operator `mailbox:backfill`; `listUrgentCandidates` and the metrics skip `backfilled_at` mail.
- N1 (`refreshFlags` and `skipped` mail) is stage 06 work: not touched here.

## Every place a value is copied (stage 05 adds no delete rule)

| Value | Source | Copy | Removed by |
| --- | --- | --- | --- |
| mail row of the last 30 days (subject, addresses, body up to 100 000 chars) | the mailbox INBOX | `emails` row (`skipped` / `history_check`), `email_headers` row | the normal retention of `emails` (body clear), DSR erase (`delete from emails`), mailbox and org delete. History rows are ordinary `emails` rows: no new table, no new column |
| one `history_checks` row per connect | `connectMailbox` / OAuth Connect / CLI | `history_checks` (stage 03 table; ids and counts only) | mailbox or org delete (stage 03 notes) |

The hook copies no mail value: it passes `ctx` and a mailbox id.

## Owner-facing facts

- The connect hook runs after the commit, and only when `trust_ladder` is on and the org is not suspended. A failure logs `connect_hook_failed` (error name and code) and never fails the connect.
- `trust:history-check` ignores the flag (an operator asked for it) but refuses a suspended org and an unknown mailbox.
- `trust_ladder` is declared here in `features.ts` with the same text as the stage 04 branch, so the two merge without a conflict.
