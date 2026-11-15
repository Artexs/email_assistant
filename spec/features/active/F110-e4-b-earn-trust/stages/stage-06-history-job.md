# F110 stage 06 — History check job: claim, backfill, flags wait `[risky]`

Part of [`../plan.md`](../plan.md). Risk: exactly-once, crash and repeat, two runs at once.

## Step 1 — The job and its claim

- **Goal:** a job moves each check through its states; two processes never work one check at once (D13).
- **Files:** `trust/history-job.ts`; registration in `main.ts` as `trust.history` every 15 s (only when `TRIAGE_LLM_SCOPE` is not `off`, as the triage worker).
- **Decisions:**
  - One claim per run per org: `FOR UPDATE SKIP LOCKED` on the oldest due row (`next_attempt_at <= now`, status not end). Set `locked_at`. A lock older than 10 min is stale and taken again; that take-back counts one attempt.
  - A step error counts one attempt and sets `next_attempt_at = now + 5 min`; at 3 attempts → `no_result` / `stopped`.
  - An auth refusal (stage 05 result `auth_refused`, or `MailAuthError` / `protocolDisabled` from `refreshFlags`) ends the check at once: `no_result` / `auth_refused`, no retry (review 2 B1).
  - A suspended org, a paused mailbox, or `trust_ladder` off: the check waits (no attempt); a removed mailbox cascades.
  - Each run also queues a check with reason `flag_on` for every `active` mailbox of a flag-on org that has no `history_checks` row at all, so turning the flag on for existing mailboxes starts their checks (review 1 N3).
- **Test** (`apps/server/test/integration/trust-history-job.test.ts`, fixed clock):
  1. Two job runs at once on one `queued` check → exactly one advances it.
  2. A check locked 11 min ago → the next run takes it, `attempts` = 1.
  3. Three step errors → `no_result` / `stopped`.
  4. Flag turned on for an org with one active mailbox and no check → one `queued` row, reason `flag_on`; the next run makes no second row.
  4a. A fake opener that throws `MailAuthError` → one run ends `no_result` / `auth_refused`; no second login.

## Step 2 — Backfill step

- **Goal:** `queued` → `backfilling` → `waiting_flags`.
- **Decisions:**
  - `window_start` = now − 30 days, set once at the first claim and kept on repeat.
  - Calls `backfillMailbox(..., { purpose: "history", days: 30 })` (stage 05). The repeat after a crash is safe (dedup).
  - Refusal mapping: never synced → wait 5 min, no attempt (the first sync comes within minutes); UIDVALIDITY change → `no_result` / `uidvalidity`; no mail in the window → `no_result` / `no_history`.
  - Sets `backfill_done_at` and `key` = `runningEvidenceKey` at this moment.
  - Then calls `refreshFlags` for this mailbox once, through the stage 05 opener (export it from `mail/index.ts` if needed), so the flags of the history mail do not wait for the 10-minute sync cadence (review 1 N12).
- **Test:**
  5. GreenMail INBOX with 5 mails → `waiting_flags`, 5 history rows, `key` set.
  6. A crash between the backfill and the status write (throw in a test hook) → the next run ends in `waiting_flags` with no duplicate mail.
  7. Empty INBOX → `no_result` / `no_history`.

## Step 3 — Flags wait

- **Goal:** the classify step starts only when the flags of the window are known (D6), or after a time limit (the fallback when the direct refresh of Step 2 did not cover every mail: it reads at most 3000 per run).
- **Decisions:** the step passes to `classifying` when every mail of the window has an `email_flags` row with `checked_at >= backfill_done_at`, or 20 min after `backfill_done_at` (mail without a row then counts as not acted on). Each wait is a reschedule in 1 min, no attempt.
- **Not verified N1:** `refreshFlags` (`mail/flags.ts`) picks `skipped` mail. Test it here; if its target query leaves out `skipped` mail, include `history_check` mail and say so in the final message.
- **Test:**
  8. GreenMail INBOX with one mail `\Answered` and one `\Flagged` → after the backfill step's own refresh, the next run passes to `classifying`; both flags stored.
  9. A refresh that fails (fake port error), clock + 19 min → still waiting; + 21 min → `classifying`.

## Check

`bun test apps/server/test/integration/trust-history-job.test.ts`

## Done when

- Logs carry the check id, mailbox id and status only.
- Proof (`s06`) prints `PROOF_OK`.

## Out of scope

The classify step and the result (stage 07).
