# F100 stage 16 — Weekly report: core, the outbox kind migration

Part of [`../plan.md`](../plan.md). **[risky]**: the second migration of this ticket (an outbox kind). Review job before the land. Needs stages 09 and 14 on `master` (14 edits the same notice files). Coordinator step C1 after the land.

After this stage the pure parts of the Monday message and of the digest's handled-share line exist (flags `weekly_report` and `handled_share`, the kind `weekly_report`, its strict view and renderer) and the database accepts the kind (D23, D24). Nothing queues it yet: stage 17 adds the detector. Together the two stages follow the checklist "Add a notice kind" of `docs/code-patterns.md` § Notices are facts: this stage does steps 1–2.

**Note for the registry test:** `channels/notices/registry.test.ts` checks that every kind has a detector or a `queuedBy` entry. Until stage 17, add `weekly_report: "channels/notices/weekly-report.ts (stage 17)"` to `queuedBy` in `channels/notices/index.ts`; stage 17 moves it to `detectors`.

## Step 1 — Core: flags, kind, view, renderer, digest line

**Goal.** The pure parts of the notice and of the digest line (D23, D24, D26, D27).

**Files.** `packages/core/src/features.ts` (+ test) and the three tests that list every flag (plan § Rules for every stage, flag rule), `packages/core/src/notices/kinds.ts`, `views.ts`, `renderers.ts`, `packages/core/src/notices/registry.test.ts`, `packages/core/src/digest/weekly.ts` (new) + `weekly.test.ts`, `packages/core/src/digest/digest.ts` (`DigestInput.handled`) + `digest.test.ts`, `packages/core/src/digest/index.ts`.

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
10. `Auto: ` + one item per bar category that has an `auto` row, in `barCategories` order, joined by `; `. With several mailboxes, the auto row with the most `kept` stands for the category. Item: `kept ≥ 30` (`EVIDENCE_MIN_LABELS`) → `${category} ${Math.round(precision × 100)}% of ${kept} labels (lower bound ${Math.round(wilsonLower × 100)}%)`; `kept < 30` → `${category} fewer than 30 labels (${kept})` (PD-066: precision only from 30 labels). No auto row → `Auto: no category on auto`. Holdout, history check and tripwire are not in this line yet (E4-B, questions Q12).
11. Only when `answeredWaiting > 0`: `/review: ${n} replied ${n === 1 ? "mail waits" : "mails wait"} for a check.`

Digest line (D24): when `handled` is set and `triaged > 0`, the footer gets, after the LLM pause line of stage 07, `🤖 Handled in the last 7 days: ${rateText(handled, triaged)}`; with `shadowOnly && handled === 0`: `🤖 Would handle in the last 7 days: ${rateText(wouldHandle, triaged)}`.

**Decisions.** D23, D24, D26, D27.

**Test** (unit):

1. `renderWeeklyReport` with the `WeekStats` of stage 12 step 1 case 1 (literal), `m8` with one row `notification` `auto: true`, `kept: 41`, `precision: 0.97`, `wilsonLower: 0.874` and four rows `auto: false`, `answeredWaiting: 2`, `timeZone: "Europe/Warsaw"` → exactly:

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

**Check.** `bun test packages/core/src/digest/ packages/core/src/notices/ packages/core/src/features.test.ts apps/server/test/integration/tenancy-features.test.ts apps/server/test/integration/web-operator.test.ts apps/server/test/integration/org-flag-cli.test.ts`

**Done when.** Cases 1–6 pass.

**Out of scope.** The Polish texts while `packages/core/src/texts/notices.ts` (weekly report) and `digest.ts` (handled-share line) do not exist; when one exists (F098 stages 08 and 10), its texts follow plan D31 (an entry in the notice texts section with `en` and `pl`, `texts: CoreTexts` last), and the expected text of case 1 stays the English one.

## Step 2 — Migration

**Goal.** The database accepts the kind (checklist step 2).

**Files.** `db/migrations/<YYYYMMDDHHMMSS>_weekly_report_kind.sql` (later than every file), `apps/server/src/platform/db/schema.ts` (through `bun run db:types`; it may not change).

```sql
-- migrate:up
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held', 'weekly_report'));

-- migrate:down
DELETE FROM outbox WHERE kind = 'weekly_report';
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed', 'send_held'));
```

The list above is the one of `20261114100003_outbox_send_held.sql` (F099 stage 05, 12 kinds) plus `weekly_report`. Do not touch the separate constraint `outbox_send_held_mailbox_check` of that file. First read the current list in your job DB (`pg_get_constraintdef` of `outbox_kind_check`): if another ticket added a kind meanwhile, keep it in both lists and say so.

**Decisions.** D1.

**Test.** `apps/server/test/integration/telegram-schema.test.ts` (the CHECK equals `noticeKinds`) passes.

**Check.** `bun run db:migrate && bun run db:rollback && bun run db:migrate && bun test apps/server/test/integration/telegram-schema.test.ts` (last lines to `/tmp/f100-s16/migrate.log`).

**Done when.** The commands pass.

**Out of scope.** Any other column.

## Done when (stage)

Steps 1–2 done; the Proof command of `plan.md` passes (`/tmp/f100-s16`).
