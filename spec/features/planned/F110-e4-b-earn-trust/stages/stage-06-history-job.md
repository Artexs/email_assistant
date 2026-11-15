# F110 stage 06 — History check job: claim, backfill, flags wait `[risky]`

Part of [`../plan.md`](../plan.md). Risk: exactly-once, crash and repeat, two runs at once.

## Step 1 — The job and its claim

- **Goal:** a job moves each check through its states; two processes never work one check at once (D13).
- **Files:** `trust/history-job.ts`; registration in `main.ts` as `trust.history` every 30 s (only when `TRIAGE_LLM_SCOPE` is not `off`, as the triage worker).
- **Decisions:**
  - One claim per run per org: `FOR UPDATE SKIP LOCKED` on the oldest due row (`next_attempt_at <= now`, status not end). Set `locked_at`. A lock older than 10 min is stale and taken again; that take-back counts one attempt.
  - A step error counts one attempt and sets `next_attempt_at = now + 5 min`; at 3 attempts → `no_result` / `stopped`.
  - A suspended org, a paused or removed mailbox, or `trust_ladder` off: the check waits (no attempt), except a removed mailbox (cascade).
- **Test** (`apps/server/test/integration/trust-history-job.test.ts`, fixed clock):
  1. Two job runs at once on one `queued` check → exactly one advances it.
  2. A check locked 11 min ago → the next run takes it, `attempts` = 1.
  3. Three step errors → `no_result` / `stopped`.

## Step 2 — Backfill step

- **Goal:** `queued` → `backfilling` → `waiting_flags`.
- **Decisions:**
  - `window_start` = now − 30 days, set once at the first claim and kept on repeat.
  - Calls `backfillMailbox(..., { purpose: "history", days: 30 })` (stage 05). The repeat after a crash is safe (dedup).
  - Refusal mapping: never synced → wait 5 min, no attempt (the first sync comes within minutes); UIDVALIDITY change → `no_result` / `uidvalidity`; no mail in the window → `no_result` / `no_history`.
  - Sets `backfill_done_at` and `key` = `runningEvidenceKey` at this moment.
- **Test:**
  4. GreenMail INBOX with 5 mails → `waiting_flags`, 5 history rows, `key` set.
  5. A crash between the backfill and the status write (throw in a test hook) → the next run ends in `waiting_flags` with no duplicate mail.
  6. Empty INBOX → `no_result` / `no_history`.

## Step 3 — Flags wait

- **Goal:** the classify step starts only when the flags of the window are known (D6), or after a time limit.
- **Decisions:** the step passes to `classifying` when every mail of the window has an `email_flags` row with `checked_at >= backfill_done_at`, or 40 min after `backfill_done_at` (mail without a row then counts as not acted on). Each wait is a reschedule in 1 min, no attempt.
- **Not verified N1:** `refreshFlags` (`mail/flags.ts`) picks `skipped` mail. Test it here; if its target query leaves out `skipped` mail, include `history_check` mail and say so in the final message.
- **Test:**
  7. After `refreshFlags` ran once on the GreenMail INBOX (one mail `\Answered`, one `\Flagged`) → the check passes to `classifying`; both flags stored.
  8. No refresh, clock + 39 min → still waiting; + 41 min → `classifying`.

## Check

`bun test apps/server/test/integration/trust-history-job.test.ts`

## Done when

- Logs carry the check id, mailbox id and status only.
- Proof (`s06`) prints `PROOF_OK`.

## Out of scope

The classify step and the result (stage 07).
