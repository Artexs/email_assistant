# s3-assist-actions — Stage 11

Part of [`../s3-assist-actions.md`](../s3-assist-actions.md). Read that file's "Input" and "Rules for every step" first.

## Stage 11 — `triage.returned`: a user move back becomes feedback [risky]

- [ ] **11.1 `createReturnedJob` (D12, architecture §4.4)**
  - Goal: a mail that the user put back into INBOX after a system move gives exactly one `imap_move` feedback row and marks the move `undone`; after an Undo it gives none; the flag is cleared in every case.
  - Files: create `apps/server/src/modules/triage/returned.ts`, `apps/server/test/integration/triage-returned.test.ts`; change `apps/server/src/modules/triage/index.ts`, `apps/server/src/modules/triage/feedback.ts` (`recordFeedback(db: Db | Transaction<DB>, …)`: the type widens, the body is unchanged), `apps/server/src/modules/mail/repo.ts` (`listReturned(db, ctx, mailboxId, opts: { limit }): Promise<{ id: string }[]>` ordered by `returned_at`, `id`; `clearReturned(trx, ctx, emailId): Promise<boolean>` sets `returned_at = NULL WHERE returned_at IS NOT NULL`), `apps/server/src/modules/mail/index.ts`.
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
    - `processReturned`, one transaction: `move = latestOriginalMove(trx, ctx, emailId)`; `category = latestTriageResult(trx, ctx, emailId)?.category`; `feedback = move !== undefined && move.status === "applied" && move.reverseStatus === null && category !== undefined && category !== "unsure"`; when `move?.status === "applied" && move.reverseStatus === null` → `markUndone(move.id, { reason: "user_moved_back" })` + audit `action.undone` (`data: { reason: "user_moved_back" }`); when `feedback` → `recordFeedback(trx, ctx, { emailId, verdict: "wrong", source: "imap_move" })` (no user id: the mailbox owner acted in the mail client, the row stays anonymous like `cli` rows without a user); audit `email.returned` (`data: { mailbox_id, feedback, move_action_id: move?.id ?? null }`); `clearReturned`. A mail with no original move (the system only flagged it, or S1a test data) → no feedback, cleared. A move with a reverse in any status → no feedback (the user tapped Undo; the `undo` feedback row exists already) and no `markUndone` (the reverse's commit does it, or did it).
    - A row returned a second time (the user moves the mail out and back again) finds the move `undone` → no second row (done-when "exactly one"). The system never moves a mail twice (one plan per mail), so a later return can only come from the user.
    - Log: `returned <emailId>: feedback <bool>` (debug), per run `returned <mailboxId>: processed <n>` (info, only when `n > 0`).
  - Test (`triage-returned.test.ts`, `withRollback`, `pauseOtherMailboxes`, fixtures): (1) `info` mail with an `applied` move (no reverse), `returned_at` set → one `triage_feedback` row (`wrong`, `imap_move`, `true_category` null, `user_id` null), the move `undone` / `user_moved_back`, `returned_at` null, audit `action.undone` and `email.returned` with `feedback` true; (2) the same mail flagged `returned_at` again → no new feedback row, no error; (3) move `undone` with a reverse `applied` (an Undo happened) → no feedback row, `returned_at` cleared, `email.returned` with `feedback` false; (4) a reverse `ready` (Undo under way) → no feedback, the move stays `applied`; (5) category `unsure` (move to `AI/Manual`) → no feedback row, the move `undone`; (6) only a `flag` action → no feedback, cleared; (7) org B's returned mail is untouched by org A's run; (8) the job processes 3 returned rows of one mailbox in one run and leaves 0 flags; (9) `recordFeedback` inside a transaction: the row is visible in the same transaction (the widened type works).
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass. Together with stage 5.2 (a second identical copy is stored as `#2` and triaged) and stage 6 (below-cursor return) this covers the done-when item on returns.
  - Out of scope: `main.ts` wiring (stage 15).
