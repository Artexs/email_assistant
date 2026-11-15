# F102 stage 09 review (Opus, PASS) and follow-up

Review job `2026-11-15-f102-review-s09-opus-card-sync-o-9d034fbc`, candidate 20d264be. Result: PASS, no blocking finding.

## Test gaps (closed in the follow-up commit)

- TG1: test "a real Postgres error inside the hook" wraps the real `cardEditHooks` with `sendId: "not-a-uuid"`, so `heldReason` raises 22P02 inside the savepoint. The decision stays `approved`, the `action.approved` audit row stays, no edit row is queued, the log line holds only the error name and code (the non-uuid id is dropped by the logger), and a later `select 1` runs. Mutation mD (the savepoint, rollback and release lines removed) fails it with 25P02 (`/tmp/f102-s09/mutD.log`); source restored.
- TG2: held approval with `exceptUserId` (two owners, `SEND_SCOPE` off, U1 taps Approve): the tap edits C1, one `approved_held` row for C2 with `heldBy` scope, C2 keeps Reject; U2 then taps Reject and no card is edited twice.
- TG3: a card with the text `[removed]` gets no queued row (queue side).
- Also added: re-link of the same chat gives `no_target` (N4), and a card of another organization with the dedup key of this send gets no row.

## Notes

- N1: `newerEditSent` can drop a correct row. A decision reads its `at` before the send lock, so a decision that commits later can have an earlier `created_at`. Example: approve (held) with now=t2 commits and its C2 row is sent; then a reject with now=t1<t2 commits; its C2 row is `stale_edit`, and C2 shows "approved, held" on a rejected send. The window is milliseconds of lock wait. The outcome check already orders the rows: no two outcomes can both match the final send state. Open question for stage 15 or the planner: order by a value set under the lock, or skip the newer-row check when the outcome matches. The plan requires the newer-row check, so the worker did not change it.
- N2: equal `created_at` is sound. One transaction never queues two rows for the same card; set sends have no `approval:` cards.
- N3: `expired` is unused. The expiry paths call no hook, by plan (Q18: the hourly expiry job edits no card; stage 15 owns it). A late tap inside `approve` edits only the tapped card. From stage 11 a panel approve of a timed-out send leaves every card live: stage 11 must map that answer and accept the gap in writing (Carry-over added to stage 11).
- N4: the link-time guard also drops edits after a re-link of the same chat (outbox rows store no chat id). Rule 13 of `docs/capabilities/drafts-and-send.md` now says "another or the same chat after a re-link".
- N10: moving `onDecided` before `setApproved` passes all tests. It has no effect today (the hook does not read the send state, and the transaction is atomic). A future hook that reads state needs a test.
