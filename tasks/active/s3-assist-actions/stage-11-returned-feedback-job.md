# s3-assist-actions — Stage 11

Part of [`../s3-assist-actions.md`](../s3-assist-actions.md). Read that file's "Input" and "Rules for every step" first.

## Stage 11 — `triage.returned`: a user move back becomes feedback [risky]

- [ ] **11.1 `createReturnedJob` (D12, architecture §4.4)**
  - Goal: a mail that the user put back into INBOX after a system move gives exactly one `imap_move` feedback row and marks the move `undone`; after an Undo it gives none; the flag is cleared in every case.
  - Files: create `apps/server/src/modules/triage/returned.ts`, `apps/server/test/integration/triage-returned.test.ts`; change `apps/server/src/modules/triage/index.ts`, `apps/server/src/modules/triage/feedback.ts` (`recordFeedback(db: Db | Transaction<DB>, …)`: the type widens; `RecordFeedbackInput` gets `keepLabel?: boolean`: when the latest feedback row of the mail has a `true_category`, write nothing and return `saved: false`, m14), `apps/server/src/modules/mail/repo.ts` (`listReturned(db, ctx, mailboxId, opts: { limit }): Promise<{ id: string }[]>` ordered by `returned_at`, `id`; `clearReturned(trx, ctx, emailId): Promise<boolean>` sets `returned_at = NULL WHERE returned_at IS NOT NULL`), `apps/server/src/modules/mail/index.ts`.
  - Interfaces:

    ```ts
    export interface ReturnedJobDeps {
      db: Db | Transaction<DB>;
      now(): Date;
      batchSize?: number /* 50 */;
    }
    export function createReturnedJob(deps: ReturnedJobDeps): { run(): Promise<void> };
    export async function processReturned(
      db,
      ctx,
      emailId: string,
      now: Date
    ): Promise<{ feedback: boolean; undone: boolean }>; // exported for tests
    ```

  - Decisions:
    - The job walks `listSyncTargets` (active mailboxes; a paused mailbox has no new returns because its sync is off, and its old flags wait). Per mailbox: `listReturned(limit)`; for each row `processReturned` in its own transaction; one mailbox's error does not stop the next (log `describeError`).
    - `processReturned`, one transaction: first `move = lockLatestOriginalMove(trx, ctx, emailId)` (row lock on the original move, the same lock as `lockActionsForUndo`; it reads the reverse status after the lock, M8: without the lock an Undo tap that commits in between leaves both an `undo` and an `imap_move` row); `category = latestTriageResult(trx, ctx, emailId)?.category`; `undoneNow = move?.status === "applied" && (move.reverseStatus === null || move.reverseStatus === "failed")` → `markUndone(move.id, { at: now, reason: "user_moved_back" })` + audit `action.undone` (`actionId` = the move's id, `emailId`, `data: { reason: "user_moved_back" }`). A `failed` reverse (m12): the notice told the user to move the mail by hand, the user did, so the move becomes `undone`; no feedback (the `undo` row exists). `feedback = undoneNow && move.reverseStatus === null && category !== undefined && category !== "unsure"` → `recordFeedback(trx, ctx, { emailId, verdict: "wrong", source: "imap_move", keepLabel: true })` (no user id: the mailbox owner acted in the mail client, the row stays anonymous like `cli` rows without a user; `keepLabel`: a ✏️ label with a true category stays the latest row, so `listLabeledResults` keeps it, m14; `feedback` in the audit is the `saved` result); audit `email.returned` (`emailId`, `data: { mailbox_id, feedback, move_action_id: move?.id ?? null }`); `clearReturned`. A mail with no original move (the system only flagged it, or S1a test data) → no feedback, cleared. A move with a reverse in `ready` or `applied` → no feedback (the user tapped Undo; the `undo` feedback row exists already) and no `markUndone` (the reverse's commit does it, or did it).
    - A row returned a second time (the user moves the mail out and back again) finds the move `undone` → no second row (done-when "exactly one"). The system never moves a mail twice (one plan per mail), so a later return can only come from the user. At Interia a second return is not even flagged: after the first return the row says INBOX, so it is not in the below-cursor list (D12, M12).
    - Log: `returned <emailId>: feedback <bool>` (debug), per run `returned <mailboxId>: processed <n>` (info, only when `n > 0`).
  - Test (`triage-returned.test.ts`, `withRollback`, `pauseOtherMailboxes`, fixtures): (1) `info` mail with an `applied` move (no reverse), `returned_at` set → one `triage_feedback` row (`wrong`, `imap_move`, `true_category` null, `user_id` null), the move `undone` / `user_moved_back`, `returned_at` null, audit `action.undone` and `email.returned` with `feedback` true; (2) the same mail flagged `returned_at` again → no new feedback row, no error; (3) move `undone` with a reverse `applied` (an Undo happened) → no feedback row, `returned_at` cleared, `email.returned` with `feedback` false; (4) a reverse `ready` (Undo under way) → no feedback, the move stays `applied`; (4b) m12: a reverse `failed` → the move `undone` / `user_moved_back`, no feedback row, `returned_at` cleared; (4c) m14: the latest feedback row is a ✏️ label (`true_category` = `needs_reply`) → the move `undone`, no new feedback row, `email.returned` with `feedback` false; (4d) M8, two connections (own org, D20; the pattern of `mail-claim.test.ts:144`: the org is created and committed first, the `organizations` and `users` rows are deleted in `finally`): open `trx1` with `db.transaction().execute(async (trx1) => …)`; inside it call `undo(trx1, ctx, emailId, …)` (it runs in the given transaction, the S1a pattern) and start `processReturned(db, ctx, emailId, now)` without `await` (the second connection; it waits on the row lock of the original move); wait 200 ms; leave the callback, so `trx1` commits; then `await` the promise → it sees the reverse `ready`: no `imap_move` row, the move stays `applied`, `returned_at` cleared; in total one feedback source for the mail (the test writes the `undo` row as the callback would); (5) category `unsure` (move to `AI/Manual`) → no feedback row, the move `undone`; (6) only a `flag` action → no feedback, cleared; (7) org B's returned mail is untouched by org A's run; (8) the job processes 3 returned rows of one mailbox in one run and leaves 0 flags; (9) `recordFeedback` inside a transaction: the row is visible in the same transaction (the widened type works).
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass. Together with stage 5.2 (a second identical copy is stored as `#2` and triaged) and stage 6 (below-cursor return) this covers the done-when item on returns.
  - Out of scope: `main.ts` wiring (stage 15).
