# F120 stage 09 — Contact wait for open loops

Part of [`../plan.md`](../plan.md). Decisions P5, D12, PD-109. Web stage (loops page line): Proof with the web tail.

Carry-over reads: `docs/capabilities/open-loops.md` rules 1, 2, 5, 8, 13; `apps/server/src/modules/loops/analyze.ts`, `analyze-write.ts`, `analyze-rules.ts`; `packages/core/src/loops/dates.ts` (`defaultDue`), `packages/core/src/loops/brief.ts`, `packages/core/src/texts/brief.ts`; `packages/core/src/web/loops.ts` (`LoopItem`); stage 01 `contactWaitDays`; stage 03 `readProfiles`.

## Step 1 — wait at loop open

- `contactWaitFor(db, ctx, mailboxId, counterpart)` in `contacts` (interfaces.md): the profile of the address → `contactWaitDays(median_their_reply_hours, reply_samples_theirs)`; null when no row, under 5 samples, or `senderFlags().contactWait` false (stage 03b).
- In the loops analysis write: for a new `waiting` or `delegated` loop with no stated date, read the wait of the loop's own `counterpart` value (as the write computes it today: the delegate address, or the first To, or the first Cc). With a result: `due_at = defaultDue(sent_at, waitDays, tz)`, `due_source = 'contact'`, `usual_reply_days = usualReplyDays(median)`. Else the current rule (`loop_wait_days`, `due_source = 'default'`).
- The read runs before the write transaction (it is a plain read of a derived table; no lock order change). A profile that changes between read and write is accepted.
- Thread restart, follow-up restart and Later keep their 3-day rules (D12). A stated date always wins.
- `layers.json`: edge `loops → contacts` with its `why`; `bun run graph:modules`.
- Test (integration `loops-contact-wait.test.ts`, fixed `now`, zone `Europe/Warsaw`):
  1. Counterpart with median 20 h, 5 samples, flag on → `due_source contact`, due = 2 working days after `sent_at` at 17:00 local, `usual_reply_days 1`.
  2. 4 samples → `due_source default`, `loop_wait_days` used.
  3. Flag `contact_wait` off → `default`; `contact_wait` on and `sender_context` off → `default`.
  4. Stated date in the mail → `stated`, no `usual_reply_days`.
  5. `delegated` loop → the delegate's profile decides. A Cc-only `waiting` loop → the Cc address's profile decides.
  6. Owner `loop_wait_days = 5`, contact wait 2 → 2 (P5).
  7. Sent on a Friday, wait 2 → due Tuesday 17:00.

## Step 2 — show it

- The `due_source` enums in `loops/repo.ts` and `core/web/loops.ts` add `contact`. `LoopItem` gets `usualReplyDays: number | null` (null unless `due_source = contact`).
- The brief ⏳ line of such a loop ends with en ` · usual reply: {n} day(s)`, pl ` · zwykle odpowiada w {n} dni` (`1 dzień`, plural helper of the brief texts). Counts and fixed words: no consent change. The digest view keeps accepting rows of the last 24 h without the new data (rollback note in stage 12).
- The panel Waiting and Delegated tabs show `Usual reply: {n} days` / `Zwykle odpowiada w {n} dni` under the due date.
- Test:
  1. Core: `renderBrief` with a loop line `usualReplyDays 2` → the en and pl suffix; null → no suffix; 1 → singular.
  2. Integration: `GET /api/loops?kind=waiting` → `usualReplyDays 1` for the loop of step 1 test 1, null for test 2.
  3. E2E: the loops page shows the line for a seeded `contact` loop.

## Done when

All tests pass; mutation: use `median_user_reply_hours` instead of the their-reply median → test 1 fails (fixture sets them apart: user 100 h). Then the Proof command with the web tail.
