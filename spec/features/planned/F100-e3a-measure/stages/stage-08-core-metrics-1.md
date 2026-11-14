# F100 stage 08 — Core metrics I: week math, M1, M2, M3

Part of [`../plan.md`](../plan.md). Pure code in `packages/core`; may run any time, next to other stages.

After this stage `@ea/core` has the week and working-day functions and the definitions of M1, M2 and M3 as pure functions over plain rows (D9–D13). The server readers (stages 10–11) and the E2b week scorer feed them.

## Step 1 — Week math and Wilson

**Goal.** One definition of "the week" and of "one working day later" (D9); the Wilson interval for the M1 sample (D11).

**Files.** `packages/core/src/metrics/week.ts` (new), `week.test.ts` (new), `packages/core/src/metrics/index.ts` (new), `packages/core/src/index.ts` (`export * from "./metrics"`), `packages/core/src/triage/metrics.ts` (only if `wilsonInterval` is missing, see below).

**Interfaces.**

```ts
/** The Monday (YYYY-MM-DD, local) of the week that holds `at` in `timeZone`. */
export function weekStartOf(at: Date, timeZone: string): string;
/** [start, end): Monday 00:00 local to the next Monday 00:00 local, through localToInstant (a DST week has 167 or 169 hours). */
export function weekRange(weekStart: string, timeZone: string): { start: Date; end: Date };
/** The Monday 7 days before `weekStart`. */
export function previousWeekStart(weekStart: string): string;
/** The last finished week at `now`: previousWeekStart(weekStartOf(now)). */
export function lastFinishedWeek(now: Date, timeZone: string): string;
/** `at` plus `days` local weekdays (Mon–Fri, no holidays), same local clock time. A Saturday or Sunday start moves from Monday. */
export function addWorkingDays(at: Date, days: number, timeZone: string): Date;
```

Build them on `localDateTime`, `localToInstant` and `nextLocalDate` (`packages/core/src/digest/local-time.ts`); the weekday of a local date is `new Date(`${date}T00:00:00Z`).getUTCDay()`. No `Date.now()`.

`addWorkingDays` rule: start from the local date and time of `at`; step one local date at a time; each step that lands on Mon–Fri counts one; stop after `days` counted steps; return `localToInstant(date, time, timeZone)`. A Friday 10:00 + 1 → Monday 10:00; a Saturday 10:00 + 1 → Monday 10:00; a Sunday + 1 → Monday.

Wilson: run `grep -n "export function wilsonInterval" packages/core/src/triage/metrics.ts`. If it exists (F097 stage 14 landed), import it. If not, add it there with exactly the F097 D23 contract — `wilsonInterval(successes: number, n: number, z = 1.959964): { lower: number; upper: number }`, `n = 0` → `{ lower: 0, upper: 1 }`, clamp to [0, 1] — and the test cases `(0, 0) → { 0, 1 }`, `(10, 10) → lower ≈ 0.7225 (±0.0005), upper = 1`, `(189, 189) → lower ≥ 0.98`, `(5, 10) → lower ≈ 0.2366, upper ≈ 0.7634`. Say in the final message which case applied.

**Decisions.** D9, D11, D17.

**Test** (unit, `week.test.ts`, `Europe/Warsaw`):

1. `weekStartOf(2026-11-18T12:00:00Z)` → `2026-11-16`; `weekStartOf(2026-11-15T22:30:00Z)` (Sunday 23:30 local) → `2026-11-09`; `weekStartOf(2026-11-15T23:30:00Z)` (Monday 00:30 local) → `2026-11-16`.
2. `weekRange("2026-11-16")` → start `2026-11-15T23:00:00Z`, end `2026-11-22T23:00:00Z`.
3. DST: `weekRange("2026-10-19")` → start `2026-10-18T22:00:00Z`, end `2026-10-25T23:00:00Z` (169 hours).
4. `previousWeekStart("2026-11-02")` → `2026-10-26`; `lastFinishedWeek(2026-11-16T08:00:00Z)` → `2026-11-09`.
5. `addWorkingDays(Fri 2026-11-20T09:00:00Z, 1)` → `2026-11-23T09:00:00Z`; Sat 2026-11-21T09:00:00Z + 1 → `2026-11-23T09:00:00Z`; Wed 2026-11-18T09:00:00Z + 3 → `2026-11-23T09:00:00Z`; + 0 → the same instant.

**Check.** `bun test packages/core/src/metrics/ packages/core/src/triage/metrics.test.ts`

**Done when.** Cases 1–5 pass (and the Wilson cases if you added it).

**Out of scope.** Holidays.

## Step 2 — M1 and M2

**Goal.** Missed important mail and open loops on time as pure functions (D11, D12).

**Files.** `packages/core/src/metrics/m1.ts`, `m2.ts`, `m1.test.ts`, `m2.test.ts`, `packages/core/src/metrics/fixtures.ts` (new: row builders `truthRow(…)`, `delegationRow(…)` with defaults; later stages add more), `metrics/index.ts`.

**Interfaces.**

```ts
// m1.ts
export const truthSources = ["correction", "review", "moved_back", "answered_check"] as const;
export type TruthSource = (typeof truthSources)[number];
/** cli, telegram, web, undo → correction; review → review; imap_move → moved_back; answered_check → answered_check. */
export function truthSourceOf(source: FeedbackSource): TruthSource;

export interface MailTruthRow {
  emailId: string;
  predicted: Category; // the latest triage result
  truth: Category | null; // true_category of the latest feedback row, else null
  truthSource: TruthSource | null; // the source of that row
  wrongOnly: boolean; // the latest feedback says "wrong" without a true category
}

export interface MissedImportant {
  important: number;
  misses: number;
  missesBySource: Record<TruthSource, number>;
  sample: { labelled: number; important: number; misses: number; missRateUpper: number | null };
}

export function isImportant(row: MailTruthRow): boolean; // D11
export function isMiss(row: MailTruthRow): boolean; // D11
export function missedImportant(rows: readonly MailTruthRow[]): MissedImportant;

// m2.ts
export const DELEGATION_DEFAULT_DUE_MS = 3 * 24 * 3_600_000;
export interface DelegationDueRow {
  id: string;
  sentAt: Date;
  dueAt: Date | null;
  answeredAt: Date | null;
  doneAt: Date | null; // the first delegation.done audit row
  overdueAt: Date | null; // the first delegation.overdue audit row
  cancelled: boolean;
}
export interface OpenLoopsOnTime {
  due: number;
  closedOnTime: number;
  surfacedOnTime: number;
  pending: number;
}
export function openLoopsOnTime(
  rows: readonly DelegationDueRow[],
  opts: { range: { start: Date; end: Date }; timeZone: string; now: Date }
): OpenLoopsOnTime;
```

Rules (D11): `isImportant` = `truth ∈ {urgent, needs_reply}`, or `truth === null && !wrongOnly && predicted ∈ {urgent, needs_reply}`. `isMiss` = `truth === "urgent" && predicted !== "urgent"`, or `truth === "needs_reply" && predicted ∈ {info, notification, spam}`. `missesBySource` counts misses by `truthSource` (a miss always has a truth source). Sample: `labelled` = rows with `truthSource === "review"` and `truth !== null`; `important` and `misses` among them; `missRateUpper = important > 0 ? wilsonInterval(misses, important).upper : null`.

Rules (D12): per row, skip `cancelled`; `due = dueAt ?? sentAt + DELEGATION_DEFAULT_DUE_MS`; only `range.start ≤ due < range.end`; `deadline = addWorkingDays(due, 1, timeZone)`; `closed = (answeredAt !== null && answeredAt ≤ deadline) || (doneAt !== null && doneAt ≤ deadline)`; `surfaced = closed || (overdueAt !== null && overdueAt ≤ deadline)`; when `deadline > now` and not `closed` → `pending` only; else `due += 1`, and `closedOnTime`, `surfacedOnTime` by the flags.

**Decisions.** D11, D12.

**Test** (unit):

1. M1: rows (predicted → truth, source): `info → urgent (correction)`, `needs_reply → null`, `urgent → null`, `info → null`, `spam → needs_reply (moved_back)`, `urgent → needs_reply (review)`, `needs_reply → info (review)`, `delegation → needs_reply (correction)`, `unsure → urgent (answered_check)`, `notification → null wrongOnly` → `important = 7`, `misses = 3` (rows 1, 5, 9), `missesBySource = { correction: 1, review: 0, moved_back: 1, answered_check: 1 }`, `sample = { labelled: 2, important: 1, misses: 0, missRateUpper ≈ 0.7935 }` (Wilson upper of 0 of 1).
2. M1: no rows → zeros, `missRateUpper = null`.
3. M2 (week `2026-11-16`, `Europe/Warsaw`, `now = 2026-11-30T12:00:00Z`; times UTC): due `2026-11-17T09:00Z` answered `2026-11-18T09:00Z` → closed and surfaced; due `2026-11-20T09:00Z` (Friday 10:00 local) answered `2026-11-23T08:00Z` → closed (deadline `2026-11-23T09:00Z`); due `2026-11-18T09:00Z`, `overdueAt` `2026-11-19T06:30Z`, never answered → surfaced only; due `2026-11-18T09:00Z`, nothing → neither; `dueAt` null and `sentAt` `2026-11-16T09:00Z` → due `2026-11-19T09:00Z`, counted, nothing else; due `2026-11-23T09:00Z` → not in the week; a cancelled one due `2026-11-18T09:00Z` → skipped → `{ due: 5, closedOnTime: 2, surfacedOnTime: 3, pending: 0 }`.
4. M2 with `now = 2026-11-21T08:00:00Z` and a delegation due `2026-11-20T09:00Z`, not answered → `pending = 1`, not in `due`.

**Check.** `bun test packages/core/src/metrics/`

**Done when.** Cases 1–4 pass.

**Out of scope.** E5 loop rows (seam S4).

## Step 3 — M3

**Goal.** Serious mistakes as a pure function (D13).

**Files.** `packages/core/src/metrics/m3.ts`, `m3.test.ts`, `fixtures.ts` (more builders), `metrics/index.ts`.

**Interfaces.**

```ts
export const rejectReasons = ["wrong_person", "wrong_content", "not_needed"] as const;
export type RejectReason = (typeof rejectReasons)[number];

export interface HiddenMoveRow {
  emailId: string;
  appliedAt: Date;
  folder: MoveTarget; // the move target of the original action
  truth: Category | null; // as MailTruthRow.truth
  vip: boolean; // triage_results.vip
  whitelisted: boolean; // the sender matches a whitelist rule now
}
export interface RejectRow { actionId: string; rejectedAt: Date; reason: RejectReason | null }
export interface MistakeRow { actionId: string; sentAt: Date }

export interface SeriousMistakes {
  hiddenImportant: number;
  wrongPerson: number;
  wrongContent: number;
  sentMistake: number;
  total: number; // the four above
  notNeeded: number; // shown, not counted
  noReason: number; // shown, not counted
}

export function seriousMistakes(
  input: { moves: readonly HiddenMoveRow[]; rejects: readonly RejectRow[]; mistakes: readonly MistakeRow[] },
  range: { start: Date; end: Date }
): SeriousMistakes;
```

Rules (D13): a move counts when `range.start ≤ appliedAt < range.end`, `folder !== "inbox"` and (`truth ∈ {urgent, needs_reply, delegation}` or (`folder === "ai_spam"` and (`vip` or `whitelisted`))); one count per `emailId`. A reject counts in its `rejectedAt` week by its reason; `null` → `noReason`. A mistake counts in the `sentAt` week, one per `actionId`.

**Decisions.** D13.

**Test** (unit, week `2026-11-16` `Europe/Warsaw`):

1. Moves: `ai_info` of a `needs_reply` truth in the week → 1; the same email twice → still 1; `ai_spam` of a VIP mail with truth null → 1; `ai_spam` of a whitelisted mail → 1; `ai_notifications` of a `notification` truth → 0; a move back to `inbox` with truth `urgent` → 0; an `ai_info` move of truth `urgent` applied the week before → 0.
2. Rejects in the week: `wrong_person`, `wrong_content`, `wrong_content`, `not_needed`, null → `wrongPerson 1`, `wrongContent 2`, `notNeeded 1`, `noReason 1`.
3. Mistakes: 2 in the week, 1 the week after → `sentMistake 2`; `total` = hidden + 1 + 2 + 2.

**Check.** `bun test packages/core/src/metrics/`

**Done when.** Cases 1–3 pass.

**Out of scope.** The sim-only phishing event (E2b); "wrong person" from a reassigned delegation (no capture exists).

## Done when (stage)

Steps 1–3 done; the Proof command of `plan.md` passes (`/tmp/f100-s08`).
