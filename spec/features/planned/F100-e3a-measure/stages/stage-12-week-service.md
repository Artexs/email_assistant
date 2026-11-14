# F100 stage 12 — Week service, stats route, `stats:week`

Part of [`../plan.md`](../plan.md). Review job before the land (a route and a CLI over tenant data). Needs stages 10 and 11 on `master`.

After this stage one service function turns an organization's week into a `WeekStats`; the panel route `GET /api/stats` (behind `stats_page`) and the operator CLI `bun run stats:week` both call it (D19, D20).

## Step 1 — The service

**Goal.** `weekStats` and `recentWeekStats` in `reports` (D19).

**Files.** `apps/server/src/modules/reports/metrics.ts` (new), `reports/index.ts`, `apps/server/test/integration/reports-metrics.test.ts` (new), `apps/server/src/modules/layers.json` only if the lint asks (no new same-layer edge is expected: `reports` reads `triage`, `actions`, `delegation`, `audit`, `config`, `mail`, `tenancy`, all lower layers).

**Interfaces.**

```ts
export type UrgentNoticeReader = (db: DbOrTrx, ctx: TenantContext, q: WeekQuery) => Promise<UrgentNoticeRow[]>;

export interface WeekStatsDeps {
  urgentNotices: UrgentNoticeReader; // channels' listUrgentNoticeTimes, filled by the composition root
  testMail: TestMailRule;
}

/** One week of one organization; `mailboxId` null = all mailboxes. `not_found` when the mailbox is not the organization's. */
export async function weekStats(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: { weekStart: string; mailboxId: string | null; now: Date; withEvidence?: boolean },
  deps: WeekStatsDeps
): Promise<WeekStats | "not_found">;

/** The last `weeks` finished weeks at `now`, newest first. */
export async function recentWeekStats(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: { weeks: number; mailboxId: string | null; now: Date },
  deps: WeekStatsDeps
): Promise<WeekStats[] | "not_found">;
```

`weekStats` steps: organization time zone (`getOrganization`); the mailboxes (`listMailboxes`; `mailboxId` not among them → `"not_found"`); `range = weekRange(weekStart, timeZone)`; the stage 10–11 readers with `{ range, mailboxId, testMail }`; `whitelisted` for each hidden-move row = `matchSender(fromAddress, rules).whitelisted` with `listSenderRules(db, ctx, row.mailboxId)` (read the rules once per mailbox); gates (only when `input.withEvidence`, default true): for each mailbox in scope, the real-label report as `goNoGoFor` builds it (`triage/gate.ts`: `listLabeledResults` + `buildRealReport`; pass the test-mail rule when F097 stage 01 gave `listLabeledResults` one) → per bar category `decision`, `precision`, `recall` (`report.goNoGo[category]`) and `kept`, and `parseCategoryPolicy(settings.category_policy)[category]?.auto ?? false`. Add a small exported function next to `goNoGoFor` in `triage/gate.ts` for this rather than copying its body; `mailboxes` = count of mailboxes in scope with status `active`; then `buildWeekStats(rows, { weekStart, mailboxId, timeZone, now })` (stage 09). It writes nothing.

`recentWeekStats`: `lastFinishedWeek(now, timeZone)` then `previousWeekStart` back, `weeks` times; one `weekStats` call per week, `withEvidence: true` for the newest week only (`m8` is today's evidence; older weeks get `m8: []`, cold review N14).

**Decisions.** D17, D19, D28.

**Test** (integration, `seedWeek`, `now = WEEK_NOW`, `deps.urgentNotices = listUrgentNoticeTimes`):

1. `weekStats(org A, WEEK, null)` → `m1 = { important: 5, misses: 1, missesBySource.correction = 1, sample = { labelled: 1, important: 1, misses: 0, … } }`; `m2 = { due: 2, closedOnTime: 1, surfacedOnTime: 2, pending: 0 }`; `m3 = { hiddenImportant: 2, wrongPerson: 1, wrongContent: 0, sentMistake: 1, total: 4, notNeeded: 0, noReason: 1 }`; `m4 = { triaged: 9, handled: 3, wouldHandle: 0 }`; `m5 = { urgent: 2, noticed: 1, withoutNotice: 1, quietHours: 1, p90Minutes: 3 }`; `m7.llmCalls = 10`, `m7.mailboxes = 1`, `m7.perMailboxMonthUsd ≈ 0.4112` (±0.001); `m8` has 5 rows of org A's mailbox, all `auto: false`.
2. A whitelist rule for e1's sender → no change (e1's move is not to `ai_spam`). A whitelist rule for e4's sender plus, in this test only, e4's move `payload.folder` changed to `ai_spam` → `hiddenImportant = 3`.
3. `weekStats(org B, WEEK, <org A's mailbox>)` → `"not_found"`; `weekStats(org B, WEEK, null)` → `m5.urgent = 2`, `m1.important = 2`, none of org A's numbers.
4. `recentWeekStats(org A, { weeks: 3, now: 2026-11-24T10:00:00Z })` → weekStarts exactly `2026-11-16`, `2026-11-09`, `2026-11-02`, newest first.
5. Calling `weekStats` twice gives deep-equal results and writes no row (count `audit_log` and `outbox` before and after).
6. `recentWeekStats(… weeks: 3 …)` → only the first week has `m8` rows (5); the other two have `m8 = []`.

**Check.** `bun test apps/server/test/integration/reports-metrics.test.ts`

**Done when.** Cases 1–6 pass.

**Out of scope.** Caching (one week is a few queries; the page asks for 8).

## Step 2 — Route and CLI

**Goal.** `GET /api/stats` behind `stats_page`; `bun run stats:week` for the operator (D20).

**Files.** `apps/server/src/modules/reports/routes.ts` (`statsRoutes`), `reports/index.ts`, `apps/server/src/web.ts` (mount; pass `listUrgentNoticeTimes` from `channels` and the test-mail rule as F097 stage 01 builds it for the other routes), `apps/server/src/scripts/stats-week.ts` (new), `package.json` (`"stats:week": "bun apps/server/src/scripts/stats-week.ts"`), `apps/server/test/integration/web-stats.test.ts` (new), `apps/server/test/integration/stats-week-cli.test.ts` (new, or a case in an existing CLI test file).

**Interfaces.**

```ts
export interface StatsRouteDeps extends WeekStatsDeps { db: Db; now(): Date }
export function statsRoutes(deps: StatsRouteDeps): Hono<ApiEnv>;
// GET /stats?weeks&mailboxId:
//   isFeatureOn(db, ctx, "stats_page") false → 404 { error: "not_found" }
//   parseQuery(c, statsQuerySchema) (400 on a bad query)
//   recentWeekStats(...) "not_found" → 404 { error: "not_found" }; else 200 { weeks }
```

CLI usage line: `usage: bun run stats:week --org-id <uuid> [--mailbox-id <uuid>] [--week YYYY-MM-DD]` (the week must be a Monday; default: the last finished week in the organization's time zone). It loads config and the DB as `triage-cost.ts` does, calls `weekStats`, and prints one `key value …` line per metric to stdout (the plan's D27 form: counts next to rates; `-` for a null), e.g. `m1_missed 1 of 5 (lower bound) sample 0 of 1`, `m3_total 4 hidden 2 wrong_person 1 wrong_content 0 sent_mistake 1 not_needed 0 no_reason 1`, `m8 <mailbox id> notification auto no kept 0 precision - lower - no-go: too few`. It ignores the flag. It prints no address, subject or mail id. Exit 1 with the usage line on bad arguments or `not_found`.

**Decisions.** D20, D27.

**Test.**

1. Route (`web-stats.test.ts`, the web helpers, `seedWeek`, `now = 2026-11-24T10:00:00Z`): no session → 401; owner, flag off → 404; owner, flag on (`setOrgFeature`) → 200 with 8 weeks, the first `weekStart = "2026-11-16"` equal to case 1 of step 1; `?weeks=2` → 2 weeks; `?weeks=13` → 400 (no input echoed in `details`); `?mailboxId=<org B's mailbox>` → 404; an assistant member, flag on → 200.
2. CLI: `--week 2026-11-17` (a Tuesday) → exit 1 with the usage line; a valid run against `seedWeek` (if CLI tests in this repo run the script against the test DB; else unit-test the line formatter with the case 1 `WeekStats`) → the `m3_total` line above.

**Check.** `bun test apps/server/test/integration/web-stats.test.ts apps/server/test/integration/stats-week-cli.test.ts`

**Done when.** Cases 1–2 pass; `bun run graph:modules` ran if `web.ts` gained a new module import.

**Out of scope.** The page (stage 18); the operator route (E7).

## Done when (stage)

Steps 1–2 done; the Proof command of `plan.md` passes (`/tmp/f100-s12`).
