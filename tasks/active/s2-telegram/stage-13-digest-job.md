# s2-telegram — Stage 13

Part of [`../s2-telegram.md`](../s2-telegram.md). Read that file's "Input" and "Rules for every step" first.

## Stage 13 — Digest job [risky]

- [ ] **13.1 `scheduleDigests`: one digest per member per slot**
  - Goal: at each member's digest times (organization timezone) exactly one digest row and one outbox row are made (P1, P2, D15); the sender of stage 11 sends it.
  - Files: create `apps/server/src/modules/channels/digest-job.ts`, `apps/server/test/integration/channels-digest-job.test.ts`; change `apps/server/src/modules/channels/index.ts`.
  - Interfaces:
    - `interface DigestJobDeps { db: Db | Transaction<DB>; now(): Date }`
    - `scheduleDigests(deps: DigestJobDeps): Promise<void>` — never throws. Stage 20 runs it every minute (cron `5 * * * * *`).
  - Decisions:
    - `now = deps.now()`; for each link of `listLinkedChats(db)`, in its own `try` / `catch` (an error → ``log.error(`digest for org ${orgId} user ${userId} failed: ${describeError(error)}`)``, then the next link):
      1. `ctx = { orgId }`; `getMembership(ctx, userId)` (none → next link); the timezone from `getOrganization`.
      2. `times = parseDigestTimes(member.digest_times)`; `lastKey = lastDigestSlotKey(ctx, userId)`; `linkKey = localKey(linkedAt, tz)`; `afterKey` = the greater string of `lastKey` and `linkKey` (`lastKey` may be null).
      3. `slot = dueDigestSlot({ now, timeZone: tz, times, afterKey })`; null → next link.
      4. `periodStart = digestPeriodStart(db, ctx, { userId, linkedAt }, now)`; `periodEnd = now`.
      5. `message = buildDigestMessage(db, ctx, { kind: "scheduled", periodStart, periodEnd, slot: { date: slot.date, time: slot.time, late: isLateSlot(slot, now, tz) }, now })` (read before the transaction).
      6. One transaction: `digestId = insertDigest(trx, ctx, { userId, slotKey: slot.key, periodStart, periodEnd })`; null → stop (another run made it). Else ``outboxId = insertOutbox(trx, ctx, { userId, kind: "digest", dedupKey: `digest:${slot.key}`, digestId, message, createdAt: now, nextAttemptAt: now })``; null → throw a plain `Error("digest outbox row exists")` so the transaction rolls back (a digest row never stays without its message).
      7. ``log.info(`digest ${slot.key} queued for user ${userId}: outbox ${outboxId}`)``.
    - A digest that later fails to send keeps `sent_at` NULL: the next digest covers its period (stage 9 `digestPeriodStart`).
    - The digest goes out also when it is empty (done-when "last sync HH:MM, also when it is empty"): there is no "skip empty" rule.
    - Digests ignore the quiet hours (P4); the sender sends `digest` rows at once.
  - Test (`channels-digest-job.test.ts`; `withRollback` + `isolateChannels(trx)`; org A from `createOrgWithMailbox`, its owner linked at `L` = `2026-11-05T20:00:00Z`; `setDigestTimes(["08:00", "16:00"])`; `Europe/Warsaw`):
    1. Run at `2026-11-06T06:59Z` (07:59) → no `digests` row.
    2. Run at `07:00Z` → one `digests` row, `slot_key` `2026-11-06T08:00`, `period_start` = `L − 24 h`, `period_end` = now; one outbox row, kind `digest`, key `digest:2026-11-06T08:00`, text starts with `📬 Digest 08:00 · Fri 6 Nov`.
    3. Run again at `07:01Z` → still one row of each.
    4. The first digest marked sent (`markDigestSent` and the outbox row `sent`) → a run at `15:00Z` (16:00) → a second digest whose `period_start` = the first `period_end`.
    5. The first digest not sent (outbox `failed`) → the second digest's `period_start` = `L − 24 h`.
    6. `setDigestTimes([])` → no digest at `07:00Z`.
    7. The first run of the day at `12:00Z` (13:00) → one digest for `08:00`, header ends with `(late)`.
    8. The first run of the day at `14:30Z` (15:30) → no digest (08:00 is more than 6 h back; 16:00 is not yet due).
    9. The owner linked at `2026-11-06T07:30Z` (08:30), run at `07:40Z` → no digest (the 08:00 slot is before the link).
    10. The assistant (`addMember`, linked at `L`) with times `["09:00"]` → at `07:00Z` only the owner gets a digest; at `08:00Z` the assistant gets one.
    11. Org B (own linked owner) has a result with the subject `MARKER-SUBJECT-B` in the window → A's digest text never contains it.
    12. Org B's timezone set to `Mars/Base` → A's digest is still queued; one `error` line names org B.
    13. An `urgent` result in the window → its line is in the digest text; the text has `Last sync`.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: `/digest` on demand (stage 17), the cron wiring (stage 20).
