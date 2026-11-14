# F100 stage 17 — Weekly report: detector and the digest line

Part of [`../plan.md`](../plan.md). Review job before the land (a message to every linked member). Needs stages 12, 15 and 16 on `master` (`weekStats`, `countAnsweredWaiting`, the kind).

After this stage, with the flag `weekly_report` on, every linked member gets one Telegram message on Monday with the last week's numbers, M1–M3 first (D23); with the flag `handled_share` on, the daily digest gets the handled-share line (D24). It does steps 3–5 of the checklist "Add a notice kind".

## Step 1 — Detector, digest wiring, docs rows

**Goal.** The weekly producer and the digest line on the server (D23, D24).

**Files.** `apps/server/src/modules/channels/notices/weekly-report.ts` (new), `channels/notices/index.ts` (`detectors` gains it, last; remove the stage 16 `queuedBy` entry), `channels/notices/run.ts` (`NoticeDeps` gains `testMail: TestMailRule`; fill it where the notifier deps are built, from `main.ts` like F097 fills `CommandDeps.testMail`), `apps/server/src/modules/reports/digest.ts` (`DigestRequest` gains `testMail`; `handled` when `handled_share` is on), the two callers of `buildDigestMessage` (`channels/digest-job.ts`: `DigestJobDeps` gains `testMail`, filled where `main.ts` builds the digest job deps through the Telegram runtime, the same way F097 fills `CommandDeps.testMail`; `channels/commands.ts`: from `CommandDeps.testMail`), `channels/notices/registry.test.ts`, `apps/server/test/integration/channels-notices.test.ts`, `reports-digest.test.ts`, `docs/architecture.md` §5 `outbox` row and `docs/modules.md` §3.8 (checklist step 5: kind `weekly_report`, dedup `weekly_report:<weekStart>`), and the pages: `docs/capabilities/digest-and-notices.md` (the kinds table: a `weekly_report` row with its condition, recipients "each linked member", dedup `weekly_report:<weekStart>`, no buttons; rule 4: the handled-share footer line behind `handled_share`; Entry points: `weeklyReportDetector` → `apps/server/src/modules/channels/notices/weekly-report.ts`), `docs/capabilities/measurement.md` ("What it does now" and a rule for the Monday message: the slot of D23, the snapshot of D28, Q3 one message per member; remove its "no Monday message" Limits item); refresh each "Checked against" line.

**Interfaces and rules.**

```ts
export const WEEKLY_DEFAULT_TIME = "08:00";
export const WEEKLY_EARLIEST_TIME = "07:00";
/** The member's slot: the first digest time ≥ 07:00 on that Monday, else 08:00 (local). */
export function weeklySlot(digestTimes: readonly string[]): string;
export const weeklyReportDetector: Detector; // name "weekly_report", kinds ["weekly_report"]
```

Per organization run (`OrgRun`): flag `weekly_report` off → return. A module-level `Map<string, number>` keyed `${orgId}:${weekStart}` holds the time of the last failed attempt; within 15 min of it → return (a failing queue must not recompute the week every 15 s, cold review N16); a success deletes the key. `today = localDateTime(now, timeZone).date`; not a Monday → return. `weekStart = lastFinishedWeek(now, timeZone)`; `dedupKey = weekly_report:${weekStart}`. For each member of `run.members`: `membership = await getMembership(db, ctx, member.userId)` (tenancy; `LinkedChat` has no digest times; a missing membership → skip the member), `slot = weeklySlot(parseDigestTimes(membership.digest_times))`; due when `localToInstant(today, slot, timeZone) ≤ now` (the day ends at the local midnight, so after Monday the detector stops by the Monday check); skip when `findOutboxByDedup(db, ctx, member.userId, dedupKey)` finds a row. Compute `weekStats(db, ctx, { weekStart, mailboxId: null, now }, { urgentNotices: listUrgentNoticeTimes, testMail })` at most once per run and only when a member is due and has no row; `answeredWaiting = countAnsweredWaiting(db, ctx, { since: now − 14 days, testMail })`. `queue(db, ctx, { userId, locale, kind: "weekly_report", dedupKey, view: { week, timeZone, answeredWaiting } }, now)`. A failure → `warnSkipped("weekly_report", <org id>, error)`.

Digest: `buildDigestMessage` reads `isFeatureOn(db, ctx, "handled_share")`; when on, `listHandledRows(db, ctx, { range: { start: now − 7 days, end: now }, mailboxId: null, testMail })` → `handledShare(rows)` → `handled: { …, shadowOnly: mailboxes.every((m) => m.mode === "shadow") }`.

**Decisions.** D23, D24, D28.

**Test** (integration, `seedWeek` where useful):

1. `weeklySlot(["06:30", "09:00", "18:00"])` → `09:00`; `[]` → `08:00`; `["06:00"]` → `08:00` (unit).
2. Flag on, a linked owner and an assistant with digest time `09:00`, `now = 2026-11-23T07:30:00Z` (Monday 08:30 local) → no row; `now = 2026-11-23T08:00:00Z` (09:00 local) → one `weekly_report` row per member, dedup `weekly_report:2026-11-16`, the view's `week.m3.total = 4` (org A of `seedWeek`); a second tick → no new row.
3. `now = 2026-11-24T08:00:00Z` (Tuesday) with no row → no row (the week is skipped).
4. Flag off → no row; org B (flag on, its own members) gets its own numbers, never org A's.
5. The row renders (`renderNotice("weekly_report", view, …)` ok) and the text starts with `📈 Week Mon 16 Nov – Sun 22 Nov`.
6. A member linked after 09:00 on Monday → gets the row at the next tick the same day.
7. Digest with `handled_share` on for org A at `now = 2026-11-21T08:00:00Z` → the digest text holds `🤖 Handled in the last 7 days:`; off → not.
8. `registry.test.ts`: every kind has a detector or a `queuedBy` entry (it passes with the new detector).

**Check.** `bun test apps/server/test/integration/channels-notices.test.ts apps/server/test/integration/reports-digest.test.ts apps/server/src/modules/channels/notices/ apps/server/src/capability-map.test.ts`

**Done when.** Cases 1–8 pass; `bun run graph:modules` ran if a new import edge appeared.

**Out of scope.** A mail channel for the report (E4-B); per-mailbox messages (Q3).

## Done when (stage)

Step 1 done; the Proof command of `plan.md` passes (`/tmp/f100-s17`).
