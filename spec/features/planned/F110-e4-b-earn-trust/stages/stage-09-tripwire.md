# F110 stage 09 — Tripwire on corrections `[risky]`

Part of [`../plan.md`](../plan.md). Risk: exactly-once notice, user signals that change behaviour. Behind `trust_ladder`.

## Step 1 — Count corrections per granted category

- **Goal:** a category whose moves the user corrects is paused, with one notice (D9, P2).
- **Files:** `trust/tripwire.ts`; job `trust.tripwire` every 60 s in `main.ts`. Read the corrections with one query per org.
- **Interfaces:** `runTripwire(deps, now): Promise<{ tripped: number }>`; uses `tripwireDue` (stage 01).
- **Decisions:**
  - Scope: orgs with `trust_ladder` on, not `suspended`; mailboxes in `assist`; categories with `auto: true` and a grant.
  - A correction (D9): a `triage_feedback` row with verdict `wrong` (any source: `telegram`, `web`, `undo`, `imap_move`, `review`, `cli`), `created_at` after the grant `at`, on a mail whose `move` action for this category (the category of the triage result that planned it) is `applied` or later undone. `important` = the feedback `true_category` is `urgent` or `needs_reply`.
  - Several feedback rows of one mail count once (the newest wins, as `listLabeledResults`).
  - A trip: in one transaction under the settings share-lock: `setCategoryAuto(false)` (audit `data.reason: "tripwire"`, with the counts), `insertTrip(reason, counts, granted_at = grant.at)`, and `autonomy_paused` for each linked owner. `insertTrip` returning null (already tripped for this grant) → nothing more.
  - The trip stays active until the user turns `auto` on again (stage 04 clears it); corrections before that new grant never count again.
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
- **Check:** `bun test apps/server/test/integration/trust-tripwire.test.ts`

## Done when

- The job logs one `info` line per trip with the mailbox id, category and reason; no mail ids.
- The guard check of `spec/build.md` TRACK is in the final message.
- Proof (`s09`) prints `PROOF_OK`.
- Checkpoint C1: the coordinator starts one review job over stages 03–09 after this land (not a stop).

## Out of scope

The card and report texts (stages 13, 14). A rate trigger from M4 handled-share.
