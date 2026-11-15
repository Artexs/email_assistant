# F110 stage 09 — Tripwire on corrections `[risky]`

Part of [`../plan.md`](../plan.md). Risk: exactly-once notice, user signals that change behaviour. Behind `trust_ladder`.

## Step 1 — Count corrections per granted category; pause on history `fail`

- **Goal:** a category whose moves the user corrects is paused, with one notice (D9, P2).
- **Files:** `trust/tripwire.ts`; job `trust.tripwire` every 60 s in `main.ts`. Read the corrections with one query per org.
- **Interfaces:** `runTripwire(deps, now): Promise<{ tripped: number }>`; uses `tripwireDue` (stage 01).
- **Decisions:**
  - Scope: orgs with `trust_ladder` on, not `suspended`; mailboxes in `assist`; categories with `auto: true` and a grant.
  - A correction (D9): a `triage_feedback` row with verdict `wrong` (any source: `telegram`, `web`, `undo`, `imap_move`, `review`, `cli`), `created_at` after the grant `at`, on a mail whose `move` action for this category (the category of the triage result that planned it) became `applied` after the grant `at` (it may be undone later). Both times are after the grant (review 1 T3). `tripwireDue` gets only these corrections. `important` = the feedback `true_category` is `urgent` or `needs_reply`.
  - Several feedback rows of one mail count once (the newest wins, as `listLabeledResults`).
  - A trip: in one transaction under the settings share-lock: `setCategoryAuto(false)` (audit `data.reason: "tripwire"`, with the counts), `insertTrip(reason, counts, granted_at = grant.at)`, and `autonomy_paused` for each linked owner. `insertTrip` returning null (already tripped for this grant) → nothing more.
  - The trip stays active until the user turns `auto` on again (stage 04 clears it); corrections before that new grant never count again.
  - History `fail` (review 1 N1, ADR 0028 point 2): the same run pauses a category with `auto` on whose newest `done` history check has `fail` and finished after the grant `at`: trip `history_fail`, same transaction shape, one notice. A `forced` grant is not paused by this rule (the user chose it against the evidence).
- **Test** (`apps/server/test/integration/trust-tripwire.test.ts`, fixed clock):
  1. Grant 2026-11-01T10:00Z; two `undo` corrections on 11-03 and 11-06 of applied `notification` moves → trip `corrections`, `auto` off, one outbox row per linked owner.
  2. One `web` correction with true category `needs_reply` → trip `important_hidden`.
  3. One correction only, true category `info` → no trip.
  4. Two corrections, one before the grant → no trip.
  5. Two corrections on the same mail (Undo plus ✏️) → counts once → no trip.
  6. A correction on a mail whose move was `logged` (shadow) → not counted.
  7. Two job runs at once → one trip row, one notice per owner.
  8. Flag off → no trip.
  9. After a trip, the owner turns `auto` on again (stage 04 path) → the trip is cleared; the old corrections do not trip again on the next run.
  10. Grant G1 11-01T10:00Z, moves applied 11-02 and 11-03, trip, re-grant G2 11-05T10:00Z, `wrong` feedback on those two old moves at 11-06 and 11-07 → no trip.
  11. Grant `regate` at 11-01; a history check finishes `done` with `spam` `fail` at 11-01T12:00Z → `spam` paused, trip `history_fail`, one notice; a `forced` grant → not paused.
- **Check:** `bun test apps/server/test/integration/trust-tripwire.test.ts`

## Done when

- The job logs one `info` line per trip with the mailbox id, category and reason; no mail ids.
- The guard check of `spec/build.md` TRACK is in the final message.
- Proof (`s09`) prints `PROOF_OK`.
- Checkpoint C1: the coordinator starts one review job over stages 03–09 after this land (not a stop).

## Out of scope

The card and report texts (stages 13, 14). A rate trigger from M4 handled-share.

## Carry-over from stage 04 review

- N1: a trip can race with a grant: insert the trip under the settings lock or ignore trips whose granted_at is not the current grant.at; N7: CategoryGrant.at is any string (review-4.md).

## Carry-over from stage 10 review

- Narrow the `autonomy_paused.category` view type from `BarCategory` to `MovingCategory`; pass `tripId` and `now` to `queueTrustNotice` (review-10.md).
