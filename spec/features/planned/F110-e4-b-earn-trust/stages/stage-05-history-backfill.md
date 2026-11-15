# F110 stage 05 — History backfill and queue at connect `[risky]`

Part of [`../plan.md`](../plan.md). Risk: sync and dedup, stored mail data (Q8).

## Step 1 — Backfill in history mode

- **Goal:** the existing INBOX backfill can store mail for the history check without sending it to triage (D10).
- **Files:** `mail/sync.ts` `backfillInbox` and `mail/tools.ts` `backfillMailbox` get an option `purpose: "backfill" | "history"` (default `"backfill"`: today's behaviour).
- **Decisions:**
  - `history`: a newly stored mail gets `status = 'skipped'`, `skip_reason = 'history_check'`, `backfilled_at` set; it gets its `email_headers` row as today; the cursor does not move; `requeueBackfillWindow` is not called.
  - A mail that already exists (any status) is not changed (dedup key, `ON CONFLICT DO NOTHING`).
  - `backfill` (the operator CLI) re-queues real `history_check` mail of its window as it re-queues `too_old` mail: the operator asked to triage that window (review 1 N8).
  - The same refusals as today (never synced, UIDVALIDITY change, suspended org, window > 180 days) come back as a typed result, not a throw, so stage 06 can map them to `no_result_reason`.
  - Opener (review 2 B1): the `history` path opens the mailbox through `openMailboxProvider` (`mail/open.ts`) with `oauthTokens` wired by the composition root, not through `loadImapOptions` (password only). OAuth mailboxes (F117, XOAUTH2) then work. Stage 06 `refreshFlags` uses the same opener.
  - An auth refusal (`MailAuthError`, `protocolDisabled`) comes back as the typed result `auth_refused`, not a step error.
  - Every place that counts `skipped` mail by reason (digest footers, `/status`, M-metrics) must ignore `history_check`. Grep the uses of `skip_reason` and `too_old`; list them in the final message.
- **Test** (extend `mailbox-backfill-cli.test.ts` or a new `mail-history-backfill.test.ts`, GreenMail):
  1. INBOX with 3 mails of the last 30 days, 1 already stored and `triaged` → `history` stores 2 as `skipped`/`history_check`, the triaged one is unchanged, all 3 have header rows.
  2. A second `history` run stores nothing new.
  3. The triage worker claims none of the 2 (`triage-job` helper).
  4. The digest for that day shows no "skipped" footer line for them.
  5. `purpose` omitted → today's behaviour (an existing test passes unchanged).
  6. After test 1, `purpose: "backfill"` over the same window → the 2 history mails are `pending`.
  7. OAuth mailbox (fake `oauthTokens`, fake `openProvider` that records `auth.kind`) → `auth.kind` is `"oauth"` and the history rows are stored.

## Step 2 — Queue a check at connect and from the CLI

- **Goal:** a new mailbox gets a history check without a user step (P1).
- **Files:** `mail/connect.ts` path (web and CLI share `connectMailbox`): after the mailbox commit, call an injected `onConnected(ctx, mailboxId)` hook; the composition roots wire it to `trust.queueHistoryCheck(..., "connect")` when `trust_ladder` is on for the org. New CLI `bun run trust:history-check --org-id <uuid> --mailbox-id <uuid>` (reason `cli`; prints the check id and status).
- **Decisions:** the hook runs after the commit; a failure of the hook logs one `warn` (no address) and never fails the connect. Queue only for an org that is not `suspended`.
  - The OAuth connect (`mail/oauth/apply.ts`, `applyOAuthGrant`, F117) inserts a mailbox without `connectMailbox`: it calls the same hook after its commit for a new mailbox. A reconnect queues nothing (refresh 1).
- **Test:**
  1. Web connect with the flag on → one `history_checks` row `queued`, reason `connect`.
  2. Flag off → no row.
  3. A thrown hook → the connect still answers 201 and the mailbox exists.
  4. CLI twice → one open row (stage 03 index).
  5. OAuth connect of a new mailbox with the flag on → one row `queued`, reason `connect`; an OAuth reconnect → no new row.

## Check

`bun test apps/server/test/integration/mail-history-backfill.test.ts`

## Done when

- The CLI is listed in `package.json` scripts and in `docs/capabilities/sync.md` § Entry points (one line; stage 25 writes the rest).
- Proof (`s05`) prints `PROOF_OK`.

## Out of scope

The job that runs a check (stage 06). Folders other than INBOX (F060).
