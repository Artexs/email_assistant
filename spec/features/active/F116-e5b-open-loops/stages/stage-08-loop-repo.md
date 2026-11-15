# F116 stage 08 — Loop repository, retention and switch-off

Part of [`../plan.md`](../plan.md). Needs stage 07. No migration.

## Step 1 — Repository

- **Goal:** `apps/server/src/modules/loops/repo.ts` with the reads and writes that stages 12–23 use. All take `DbOrTrx` and `TenantContext`, filter by `org_id` and, where given, the mailbox.
- **Interfaces (new):**
  - `insertLoop(trx, ctx, row) → { id } | { kind: "exists" }` (unique key of stage 07; a conflict returns `exists`, no error).
  - `lockLoop(trx, ctx, loopId) → LoopRow | undefined` (`FOR UPDATE`, D15).
  - `closeLoop(trx, ctx, { loopId, reason, emailId?, userId?, at })` and `reopenLoop(trx, ctx, { loopId, at })`: the caller holds the lock. `closeLoop` on a closed row is a no-op that returns `already`.
  - `restartLoop(trx, ctx, { loopId, sentEmailId, messageId, referencesIds, waitFrom, dueAt })` (D9).
  - `openLoopsByThread(db, ctx, mailboxId, threadKeys) → LoopRow[]` (open rows only, all kinds).
  - `listLoops` and `briefLoopsOf` (`interfaces.md`); `listLoops` pages by `(due_at, id)` with the opaque `before` cursor of the F102 delegation list.
  - Each user or system change writes one audit row: `loop.opened`, `loop.closed` (data: `loop_id`, `kind`, `reason`), `loop.reopened`, `loop.later`, `loop.restarted`. Data holds ids and codes only.
- **Decisions:** a reopened loop keeps its `due_at`, `later_count` and `follow_ups_sent`; `closed_at`, `close_reason`, `closed_by_*` go back to null. A loop whose texts were cleared (`texts_cleared_at`) cannot reopen (`not_allowed`).
- **Test (integration):** T1 insert twice → `exists`; T2 close → audit row with the reason, a second close → `already`; T3 reopen of a `replied` loop → open with the old due; T4 `openLoopsByThread` returns no closed row and no row of another mailbox or org; T5 `listLoops` with `limit` 2 over 3 rows → 2 rows and a cursor that returns the third.

## Step 2 — Retention

- **Goal:** `clearLoopTexts(db, { before, batch })` clears `subject`, `text`, `to_addresses`, `cc_addresses`, `counterpart` and sets `texts_cleared_at` on loops closed before `before` (= now − 90 days, D5), in batches with `FOR UPDATE SKIP LOCKED`, the `clearDelegationTasks` pattern. `apps/server/src/retention.ts` calls it; the retention log line adds the count `loop texts`.
- **Test (integration):** T6 a loop closed 91 days ago → cleared; one closed 89 days ago and one open since 120 days → kept; a second run changes nothing.

## Step 3 — Switch off

- **Goal:** turning "Track my sent mail" off ends what Sent mail started (D18).
- **Interfaces (new):** `SentSwitchHooks { onDisabled(trx, ctx, { mailboxId, at }) }` in module `mail` with a no-op default, passed to `setSentSync` by every caller (the composition root, the routes and CLI of F104). `onSentOff(trx, ctx, { mailboxId, at })` in `loops` is the real hook. It runs in the `setSentSync` transaction before the `sent_emails` delete.
- **Decisions:** `onSentOff` closes every open loop of the mailbox as `sent_off` and clears its texts at once; `sent_analyses` rows go by cascade. The expiry of waiting follow-ups is added in stage 10 (review G8). Org flag `open_loops` or `sent_sync` off: the jobs skip the org and the brief, routes and page hide loops; rows and texts stay until the retention rules (review N10).
- **Test (integration):** T7 two open loops and one closed loop → the open ones `sent_off` with null texts, the closed one unchanged; T8 a loop of another mailbox stays open; T9 the composition root passes `onSentOff` (a test on the wired deps, the `sentOriginOf` pattern).

## Check

`bun test apps/server/test/integration/<the new loop tests>`

## Done when

T1–T9 pass; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s08`).

## Out of scope

Any job (12, 13, 15), the follow-up kind (10).
