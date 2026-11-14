# F100 stage 14 — Weekly report and the handled-share line

Part of [`../plan.md`](../plan.md). **[risky]**: the second migration (an outbox kind) and a message to every linked member. Review job before the land. Needs stages 11, 12 and 13 on `master`. Coordinator step C1 after the land.

After this stage, with the flag `weekly_report` on, every linked member gets one Telegram message on Monday with the last week's numbers, M1–M3 first (D23); with the flag `handled_share` on, the daily digest gets the handled-share line (D24). The kind follows the checklist "Add a notice kind" of `docs/code-patterns.md` § Notices are facts, steps 1–5.

## Step 1 — Core: flags, kind, view, renderer, digest line

**Goal.** The pure parts of the notice and of the digest line (D23, D24, D26, D27).

**Files.** `packages/core/src/features.ts` (+ test), `packages/core/src/notices/kinds.ts`, `views.ts`, `renderers.ts`, `packages/core/src/notices/registry.test.ts`, `packages/core/src/digest/weekly.ts` (new) + `weekly.test.ts`, `packages/core/src/digest/digest.ts` (`DigestInput.handled`) + `digest.test.ts`, `packages/core/src/digest/index.ts`.

**Interfaces.**

```ts
// features.ts
weekly_report: { default: false, description: "The weekly report message on Monday.", epic: "E3a", removeBy: "2027-03-01" },
handled_share: { default: false, description: "The handled-share line in the daily digest.", epic: "E3a", removeBy: "2027-03-01" },

// kinds.ts: noticeKinds gains "weekly_report" (last, the same order as the CHECK list).
// views.ts
const weeklyReportView = z.strictObject({
  week: weekStatsSchema, // stage 09; mailboxId null (all mailboxes)
  timeZone: z.string().min(1),
  answeredWaiting: z.number().int().min(0),
});
// renderers.ts: weekly_report → renderWeeklyReport(view)

// digest/weekly.ts
export function rateText(n: number, d: number): string; // d = 0 → "– (0 of 0)"; else `${Math.round((100 * n) / d)}% (${n} of ${d})`
export function renderWeeklyReport(view: { week: WeekStats; timeZone: string; answeredWaiting: number }): OutMessage; // no buttons

// digest.ts
export interface DigestHandled { handled: number; wouldHandle: number; triaged: number; shadowOnly: boolean }
// DigestInput gains `handled?: DigestHandled`
```

Weekly text, line by line (D23, D27):

1. `📈 Week ${formatDay(start)} – ${formatDay(end − 1 ms)}` with `{ start, end } = weekRange(week.weekStart, timeZone)`.
2. When `m1.important === 0 && m4.triaged === 0`: `No mail this week.` (then go on with lines for M2, M3, M7, M8 and the review line only).
3. `Missed important mail (lower bound): ${rateText(m1.misses, m1.important)}`.
4. Only when `m1.sample.labelled > 0`: `Random review sample: ${m1.sample.misses} missed of ${m1.sample.important}`.
5. `Open loops on time: ${pct(closed, due)} closed (${closed} of ${due}), ${pct(surfaced, due)} surfaced (${surfaced} of ${due})` — use `rateText` pieces; with `due === 0`: `Open loops on time: no delegation was due`; append `, ${pending} still open` when `pending > 0`.
6. `Serious mistakes: ${total} (hidden important ${a}, wrong person ${b}, wrong content ${c}, sent by mistake ${d})`.
7. `Handled for you: ${rateText(handled, triaged)}`; when `handled === 0 && wouldHandle > 0`: `Would handle (shadow mode): ${rateText(wouldHandle, triaged)}`.
8. `Urgent notice time: p90 ${p90Minutes} min (${noticed} ${noticed === 1 ? "notice" : "notices"}${withoutNotice > 0 ? `, ${withoutNotice} without a notice` : ""})`; with `urgent === 0`: `Urgent notice time: no urgent mail`.
9. `Cost: $${perMailboxMonthUsd.toFixed(2)} per mailbox per month (target ≤ $${targetUsd})`; append `, ${unpricedCalls} calls without a price` when > 0.
10. `Auto: ` + the `m8` rows with `auto` joined by `; `: `${category} ${Math.round(precision × 100)}% of ${kept} labels (lower bound ${Math.round(wilsonLower × 100)}%)` (`precision` null → `${category} no labels yet`); no auto row → `Auto: no category on auto`.
11. Only when `answeredWaiting > 0`: `/review: ${n} replied ${n === 1 ? "mail waits" : "mails wait"} for a check.`

Digest line (D24): when `handled` is set and `triaged > 0`, the footer gets, after the LLM pause line of stage 07, `🤖 Handled in the last 7 days: ${rateText(handled, triaged)}`; with `shadowOnly && handled === 0`: `🤖 Would handle in the last 7 days: ${rateText(wouldHandle, triaged)}`.

**Decisions.** D23, D24, D26, D27.

**Test** (unit):

1. `renderWeeklyReport` with the `WeekStats` of stage 11 step 1 case 1 (literal), `m8` with one row `notification` `auto: true`, `kept: 41`, `precision: 0.97`, `wilsonLower: 0.874` and four rows `auto: false`, `answeredWaiting: 2`, `timeZone: "Europe/Warsaw"` → exactly:

   ```
   📈 Week Mon 16 Nov – Sun 22 Nov
   Missed important mail (lower bound): 20% (1 of 5)
   Random review sample: 0 missed of 1
   Open loops on time: 50% closed (1 of 2), 100% surfaced (2 of 2)
   Serious mistakes: 4 (hidden important 2, wrong person 1, wrong content 0, sent by mistake 1)
   Handled for you: 33% (3 of 9)
   Urgent notice time: p90 3 min (1 notice, 1 without a notice)
   Cost: $0.41 per mailbox per month (target ≤ $5)
   Auto: notification 97% of 41 labels (lower bound 87%)
   /review: 2 replied mails wait for a check.
   ```

2. An empty week (all zeros, no auto) → line 2 `No mail this week.`, `Open loops on time: no delegation was due`, `Urgent notice time: no urgent mail`, `Auto: no category on auto`; no review line.
3. `rateText(0, 0)` → `– (0 of 0)`; `rateText(1, 3)` → `33% (1 of 3)`.
4. Registry: `noticeRenderers.weekly_report` exists; the view refuses an extra key and a `week` with a `subject` field.
5. `renderDigest` with `handled: { handled: 124, wouldHandle: 0, triaged: 200, shadowOnly: false }` → footer holds `🤖 Handled in the last 7 days: 62% (124 of 200)`; with `shadowOnly: true, handled: 0, wouldHandle: 50` → `🤖 Would handle in the last 7 days: 25% (50 of 200)`; `triaged: 0` → no line; without `handled` → the old text.
6. Both flags default false, epic `E3a`.

**Check.** `bun test packages/core/src/digest/ packages/core/src/notices/ packages/core/src/features.test.ts`

**Done when.** Cases 1–6 pass.

**Out of scope.** Polish texts (E7-T1).

## Step 2 — Migration

**Goal.** The database accepts the kind (checklist step 2).

**Files.** `db/migrations/<YYYYMMDDHHMMSS>_weekly_report_kind.sql` (later than every file), `apps/server/src/platform/db/schema.ts` (through `bun run db:types`; it may not change).

```sql
-- migrate:up
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'weekly_report'));

-- migrate:down
DELETE FROM outbox WHERE kind = 'weekly_report';
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed'));
```

First read the current list in your job DB (`pg_get_constraintdef` of `outbox_kind_check`): if another ticket added a kind meanwhile, keep it in both lists and say so.

**Decisions.** D1.

**Test.** `apps/server/test/integration/telegram-schema.test.ts` (the CHECK equals `noticeKinds`) passes.

**Check.** `bun run db:migrate && bun run db:rollback && bun run db:migrate && bun test apps/server/test/integration/telegram-schema.test.ts` (last lines to `/tmp/f100-s14/migrate.log`).

**Done when.** The commands pass.

**Out of scope.** Any other column.

## Step 3 — Detector, digest wiring, docs rows

**Goal.** The weekly producer and the digest line on the server (D23, D24).

**Files.** `apps/server/src/modules/channels/notices/weekly-report.ts` (new), `channels/notices/index.ts` (`detectors` gains it, last), `channels/notices/run.ts` (`NoticeDeps` gains `testMail: TestMailRule`; fill it where the notifier deps are built, from `main.ts` like F097 fills `CommandDeps.testMail`), `apps/server/src/modules/reports/digest.ts` (`DigestRequest` gains `testMail`; `handled` when `handled_share` is on), the two callers of `buildDigestMessage` (`channels/digest-job.ts`, `channels/commands.ts`), `channels/notices/registry.test.ts`, `apps/server/test/integration/channels-notices.test.ts`, `reports-digest.test.ts`, `docs/architecture.md` §5 `outbox` row and `docs/modules.md` §3.8 (checklist step 5: kind `weekly_report`, dedup `weekly_report:<weekStart>`).

**Interfaces and rules.**

```ts
export const WEEKLY_DEFAULT_TIME = "08:00";
export const WEEKLY_EARLIEST_TIME = "07:00";
/** The member's slot: the first digest time ≥ 07:00 on that Monday, else 08:00 (local). */
export function weeklySlot(digestTimes: readonly string[]): string;
export const weeklyReportDetector: Detector; // name "weekly_report", kinds ["weekly_report"]
```

Per organization run (`OrgRun`): flag `weekly_report` off → return. `today = localDateTime(now, timeZone).date`; not a Monday → return. `weekStart = lastFinishedWeek(now, timeZone)`; `dedupKey = weekly_report:${weekStart}`. For each member of `run.members`: `slot = weeklySlot(parseDigestTimes(membership.digest_times))`; due when `localToInstant(today, slot, timeZone) ≤ now` (the day ends at the local midnight, so after Monday the detector stops by the Monday check); skip when `findOutboxByDedup(db, ctx, member.userId, dedupKey)` finds a row. Compute `weekStats(db, ctx, { weekStart, mailboxId: null, now }, { urgentNotices: listUrgentNoticeTimes, testMail })` at most once per run and only when a member is due and has no row; `answeredWaiting = countAnsweredWaiting(db, ctx, { since: now − 14 days, testMail })`. `queue(db, ctx, { userId, locale, kind: "weekly_report", dedupKey, view: { week, timeZone, answeredWaiting } }, now)`. A failure → `warnSkipped("weekly_report", <org id>, error)`.

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

**Check.** `bun test apps/server/test/integration/channels-notices.test.ts apps/server/test/integration/reports-digest.test.ts apps/server/src/modules/channels/notices/`

**Done when.** Cases 1–8 pass; `bun run graph:modules` ran if a new import edge appeared.

**Out of scope.** A mail channel for the report (E4-B); per-mailbox messages (Q3).

## Done when (stage)

Steps 1–3 done; the Proof command of `plan.md` passes (`/tmp/f100-s14`).
