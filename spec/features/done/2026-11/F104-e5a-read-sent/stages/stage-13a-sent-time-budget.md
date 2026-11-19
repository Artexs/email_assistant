# F104 stage 13a — Time budget for the Sent pass

Part of [`../plan.md`](../plan.md). **[risky]**: sync of the pilot's real mailbox. Worker `claude-sonnet-5-5`, review `claude-opus-5-5` (sync, the pilot mailbox). Added by the coordinator on 2026-11-15. It is the precondition of [stage 13](stage-13-pilot-deploy.md) § "Carry-over from stage 06 review (time budget)": the pilot flag `sent_sync` stays off until this stage is landed and released.

## Why

`runSentPass` (`apps/server/src/modules/mail/jobs.ts`) runs after the INBOX sync of each mailbox, on the same IMAP connection, inside the one `mail.sync` run. The pass has no wall-clock limit:

- Header step (`sent-sync.ts` `syncSentHeaders`): one 30-day `fetchSince` in `initial`/`rescan` mode, or `fetchAbove` in `incremental` mode.
- Text step (`sent-texts.ts` `fetchSentTexts`): up to `SENT_TEXT_RUN_LIMIT` (100) `fetchContent` calls in sequence, each up to 5 MB.
- imapflow keeps its default socket inactivity timeout (5 minutes) when `connectionTimeoutMs` is not set.

While the run is active, the scheduler skips the next `mail.sync` ticks (`job_skipped`). A slow Sent folder thus delays the INBOX sync of every later mailbox and of the next ticks. INBOX sync is the core function; the Sent read is secondary.

## Outcome

One Sent pass of one mailbox never holds the `mail.sync` run longer than a fixed budget, and the log shows how long each pass took.

## Scope

1. A constant `SENT_PASS_BUDGET_MS` in `sent-rules.ts`. Default 60 000 ms. Tests inject a smaller value through the deps.
2. A deadline per pass, from a monotonic clock in the deps (for example `elapsedMs(): number` or `deadlineAt` with `performance.now()`), not from `now()` (wall time stays the timestamp of the rows).
3. The pass checks the deadline before each IMAP call: before the header fetch, between header chunks, and before each `fetchContent` of the text step. When the budget is used up, the pass stops and returns a new status `budget` (add it to `SentPassStatus`). Rows written so far stay. Rules for the cursor:
   - `incremental`: the cursor stays at the last written chunk (as now). The next pass goes on from there.
   - `initial`/`rescan`: the cursor and `firstPassAt` do not move. The next pass repeats the header step; dedup keys keep it idempotent (as now).
   - Text step: the remaining pending rows stay pending for the next pass.
4. One IMAP call that does not return before the deadline: the pass stops waiting for it (race the call against the time left) and returns `budget`. The job then closes the connection at once, without a wait for `LOGOUT` on a stalled socket. Check what `provider.close()` does for imapflow (`imap/client.ts`): if it awaits `logout()`, add a bounded close (for example `logout` raced against a short timeout, then `client.close()`). No later IMAP call may run on that connection after a timed-out call: the Sent pass is the last step on it, keep it so.
5. A `budget` result marks the pass with `markSentPass(... errorCode: null)` (it is not an error) and logs `sent_sync_done` with `status: "budget"`.
6. `sent_sync_done` gets a field `duration_ms` (integer) for every status. Add the field to the log field registry if one exists (the F103 log lint and `log_call_invalid` rules: no free text, no path, no subject, no address).
7. Capability page `docs/capabilities/` for Sent mail: one line about the budget and the `budget` status.

## Out of scope

- No change to `SENT_TEXT_RUN_LIMIT`, `SENT_HEADER_WINDOW_MS` or the chunk size.
- No change to the INBOX sync timeouts.
- No migration. No `bun.lock` change.

## Tests (unit, with a fake `SentFolderReader` and an injected clock)

- Budget used up between header chunks in `incremental` mode → status `budget`, rows of the written chunks stored, cursor at the last written chunk.
- Budget used up in `initial` mode → status `budget`, cursor and `firstPassAt` unchanged; a second pass with enough budget ends `done` with no duplicate rows.
- Budget used up during the text step → status `budget` (or the text result shows the stop; pick one and say which), stored texts stay, the rest stay pending.
- One `fetchContent` that never resolves → the pass returns within the budget plus a small margin (fake timers or a short real budget), and the job calls the bounded close.
- `sent_sync_done` holds `duration_ms` and `status`; a `budget` pass sets no error code.

For each guard this stage adds (the deadline check before each IMAP call, the race of a single call), remove it, run its test, see the test fail, and restore it. List each guard and the failing test in your result.

## Done when

- `bun run typecheck`, `bun run lint`, `bun run test:unit:ci` and `bun run test:int:ci` pass in the job worktree.
- The stage 13 runbook (`stage-13-pilot-deploy.md`) gets one extra check line: read `duration_ms` and the count of `status":"budget"` lines of the pilot in the first hour.
