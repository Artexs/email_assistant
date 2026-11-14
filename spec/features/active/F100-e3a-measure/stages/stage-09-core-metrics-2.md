# F100 stage 09 — Core metrics II: M4, M5, M7, M8 and the `WeekStats` shape

Part of [`../plan.md`](../plan.md). Pure code in `packages/core`; after stage 08.

After this stage `@ea/core` has the M4, M5, M7 and M8 functions, the cost constants, and one Zod schema `weekStatsSchema` that the route (stage 12), the page (stage 18) and the weekly notice view (stage 16) share.

## Step 1 — M4 and M5

**Goal.** Handled share and urgent notice time as pure functions (D14, D15).

**Files.** `packages/core/src/metrics/m4.ts`, `m5.ts`, `m4.test.ts`, `m5.test.ts`, `metrics/fixtures.ts` (builders), `metrics/index.ts`.

**Interfaces.**

```ts
// m4.ts
export interface HandledRow {
  emailId: string;
  category: Category; // the latest triage result
  mailboxActionApplied: boolean; // an original move, mark_read or flag action with status applied
  mailboxActionUndone: boolean; // an original mailbox action with status undone
  mailboxActionLogged: boolean; // an original mailbox action with status logged (shadow)
  wrongWithin7Days: boolean; // a "wrong" feedback row created ≤ 7 days after the triage result
  delegationSendApplied: boolean; // a send with payload.kind "delegation", status applied
  delegationCancelled: boolean; // its delegation has status cancelled
}
export interface HandledShare { triaged: number; handled: number; wouldHandle: number }
export function handledShare(rows: readonly HandledRow[]): HandledShare;

// m5.ts
export interface UrgentNoticeRow { emailId: string; receivedAt: Date; noticeAt: Date | null }
export interface UrgentLatency {
  urgent: number; // rows outside quiet hours
  noticed: number;
  withoutNotice: number;
  quietHours: number; // rows that arrived in quiet hours (left out of the rest)
  p90Minutes: number | null; // nearest rank, one decimal
}
export function urgentLatency(rows: readonly UrgentNoticeRow[], opts: { timeZone: string }): UrgentLatency;
```

Rules (D14): `handled` = (`category ∈ {spam, notification, info}` and `mailboxActionApplied` and not `mailboxActionUndone` and not `wrongWithin7Days`) or (`category === "delegation"` and `delegationSendApplied` and not `delegationCancelled`). `wouldHandle` = `category ∈ {spam, notification, info}` and `mailboxActionLogged` and not `wrongWithin7Days`. `triaged` = the row count.

Rules (D15): a row with `isQuietTime(receivedAt, timeZone)` → `quietHours` only. Else `urgent += 1`; `noticeAt === null` → `withoutNotice`; else `noticed` and its minutes `max(0, noticeAt − receivedAt) / 60000`. `p90Minutes`: sort ascending, take index `ceil(0.9 × n) − 1`, round to one decimal (`Math.round(x * 10) / 10`); `n = 0` → null.

**Decisions.** D14, D15.

**Test** (unit):

1. M4: `info` applied → handled; `info` applied + undone → not; `notification` applied + `wrongWithin7Days` → not; `spam` logged only → wouldHandle, not handled; `delegation` with send applied → handled; `delegation` send applied + cancelled → not; `urgent` applied → not; `needs_reply` nothing → not → `{ triaged: 8, handled: 2, wouldHandle: 1 }`.
2. M5 (`Europe/Warsaw`): 10 rows received at 10:00 local on 2026-11-17 with notice delays 1, 1, 2, 2, 2, 3, 3, 4, 6, 9 minutes → `p90Minutes = 6`; one more row received at 23:30 local → `quietHours = 1`, not in `urgent`; one more row at 12:00 local with `noticeAt` null → `withoutNotice = 1`, `urgent = 11`, `noticed = 10`.
3. M5: no rows → `p90Minutes = null`, zeros.

**Check.** `bun test packages/core/src/metrics/`

**Done when.** Cases 1–3 pass.

**Out of scope.** The readers that fill the booleans (stages 10–11).

## Step 2 — M7, M8 and the cost model

**Goal.** Cost per mailbox per month and the auto evidence rows (D16, D17).

**Files.** `packages/core/src/metrics/cost-model.ts`, `m7.ts`, `m8.ts`, their tests, `metrics/index.ts`.

**Interfaces.**

```ts
// cost-model.ts — reference numbers with source and date (like llmPrices in triage/cost.ts).
export const costModel = {
  hostingUsdPerMonth: 7.1, // Hetzner CX23 €5.99 per month, E3 notes §4 (checked 2026-11-10)
  mailboxesPerHost: 20, // assumption until the E8 load test (PD-059)
  backupUsdPerMailboxMonth: 0.05, // assumption: B2 and domain, shared; E3 notes §4 "< 0.1"
  targetUsdPerMailboxMonth: 5, // PD-059
  source: "docs/product/stage-2/epics/E03-discovery-notes.md §4",
  checked: "2026-11-13",
} as const;

// m7.ts
export interface LlmCallRow { mailboxId: string | null; model: string | null; tokensIn: number | null; tokensOut: number | null; at: Date }
export interface UnitCost {
  llmUsdWeek: number;
  llmCalls: number;
  unpricedCalls: number;
  mailboxes: number;
  hostingUsdMonth: number; // per mailbox
  backupUsdMonth: number; // per mailbox
  perMailboxMonthUsd: number;
  targetUsd: number;
}
export function unitCost(rows: readonly LlmCallRow[], opts: { mailboxes: number }): UnitCost;

// m8.ts
export interface GateRow {
  mailboxId: string;
  category: BarCategory;
  auto: boolean;
  kept: number;
  precision: number | null;
  recall: number | null; // of the same real labels (GoNoGoRow.recall)
  decision: GoDecision;
}
export interface AutoEvidence extends GateRow { wilsonLower: number | null }
export const EVIDENCE_MIN_LABELS = 30; // PD-066: real-label precision is shown only from 30 labels
export function autoEvidence(rows: readonly GateRow[]): AutoEvidence[];
```

Rules (D16): per row `costPerMail(model, tokensIn ?? 0, tokensOut ?? 0, at)`; `model === null` or a null price → `unpricedCalls += 1` (cost 0). `mailboxes = max(1, opts.mailboxes)`. `hostingUsdMonth = hostingUsdPerMonth / mailboxesPerHost`; `perMailboxMonthUsd = llmUsdWeek × 30 / 7 / mailboxes + hostingUsdMonth + backupUsdPerMailboxMonth`.

Rules (D17): `wilsonLower = precision === null || kept === 0 ? null : wilsonInterval(Math.round(precision × kept), kept).lower`. Order: input order.

**Decisions.** D16, D17.

**Test** (unit):

1. M7: 1,000 `gpt-6-luna` rows of 1,036 in and 80 out tokens at `2026-11-17T10:00:00Z`, 2 rows of model `gpt-6.1-terra`, 1 row with null tokens → `llmCalls = 1,003`, `unpricedCalls = 2`, `llmUsdWeek ≈ 0.1436` (±0.0001), with `mailboxes: 1` → `perMailboxMonthUsd ≈ 0.1436 × 30 / 7 + 0.355 + 0.05 ≈ 1.0204` (±0.001).
2. M7 with `mailboxes: 0` → treated as 1.
3. M8: `{ precision: 0.97, kept: 41 }` → `wilsonLower` = `wilsonInterval(40, 41).lower` (≈ 0.874, ±0.002); `{ precision: null, kept: 0 }` → null; `recall` passes through unchanged.

**Check.** `bun test packages/core/src/metrics/`

**Done when.** Cases 1–3 pass.

**Out of scope.** Holdout, history check and tripwire fields (E4-B, seam S2).

## Step 3 — `WeekStats` schema

**Goal.** One shape for a week's numbers, used by the route, the page and the weekly view (D19, D20, D23, D27).

**Files.** `packages/core/src/web/stats.ts` (new), `stats.test.ts`, `packages/core/src/web/index.ts`, `packages/core/src/metrics/week-stats.ts` (the assembler), its test.

**Interfaces.**

```ts
// web/stats.ts — counts and numbers only: no address, no subject, no mail id.
const count = z.number().int().min(0);
export const weekStatsSchema = z.strictObject({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mailboxId: z.uuid().nullable(), // null = all mailboxes of the organization
  m1: z.strictObject({
    important: count,
    misses: count,
    missesBySource: z.strictObject({ correction: count, review: count, moved_back: count, answered_check: count }),
    sample: z.strictObject({ labelled: count, important: count, misses: count, missRateUpper: z.number().min(0).max(1).nullable() }),
  }),
  m2: z.strictObject({ due: count, closedOnTime: count, surfacedOnTime: count, pending: count }),
  m3: z.strictObject({ hiddenImportant: count, wrongPerson: count, wrongContent: count, sentMistake: count, total: count, notNeeded: count, noReason: count }),
  m4: z.strictObject({ triaged: count, handled: count, wouldHandle: count }),
  m5: z.strictObject({ urgent: count, noticed: count, withoutNotice: count, quietHours: count, p90Minutes: z.number().min(0).nullable() }),
  m7: z.strictObject({
    llmUsdWeek: z.number().min(0), llmCalls: count, unpricedCalls: count, mailboxes: count,
    hostingUsdMonth: z.number().min(0), backupUsdMonth: z.number().min(0), perMailboxMonthUsd: z.number().min(0), targetUsd: z.number().min(0),
  }),
  m8: z.array(z.strictObject({
    mailboxId: z.uuid(), category: z.enum(barCategories), auto: z.boolean(), kept: count,
    precision: z.number().min(0).max(1).nullable(), recall: z.number().min(0).max(1).nullable(),
    wilsonLower: z.number().min(0).max(1).nullable(),
    decision: z.enum(["go", "no-go", "no-go: too few"]),
  })).max(1000), // M8 is the evidence at the time of the computation, not of the week: only the newest week carries rows (stage 12)
});
export type WeekStats = z.infer<typeof weekStatsSchema>;
export const statsQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(12).default(8),
  mailboxId: z.uuid().optional(),
});
export const statsResponseSchema = z.object({ weeks: z.array(weekStatsSchema) });

// metrics/week-stats.ts — the one place that turns rows into a WeekStats.
export interface WeekRows {
  truth: readonly MailTruthRow[];
  delegations: readonly DelegationDueRow[];
  moves: readonly HiddenMoveRow[];
  rejects: readonly RejectRow[];
  mistakes: readonly MistakeRow[];
  handled: readonly HandledRow[];
  urgent: readonly UrgentNoticeRow[];
  llmCalls: readonly LlmCallRow[];
  gates: readonly GateRow[];
  mailboxes: number;
}
export function buildWeekStats(
  rows: WeekRows,
  opts: { weekStart: string; mailboxId: string | null; timeZone: string; now: Date }
): WeekStats;
```

`buildWeekStats` calls `missedImportant`, `openLoopsOnTime`, `seriousMistakes`, `handledShare`, `urgentLatency`, `unitCost`, `autoEvidence` with `range = weekRange(weekStart, timeZone)`, and its result passes `weekStatsSchema.parse` (a test asserts it). Use the zod import style of `packages/core/src/web/zod.ts` (the web schemas use it).

**Decisions.** D19, D20, D23, D27.

**Test** (unit):

1. `buildWeekStats` with the rows of stage 08 case 1, stage 08 case 3, stage 09 cases 1–3 (fixtures) → each metric equals the result of its own function, and `weekStatsSchema.parse` accepts it.
2. `weekStatsSchema` refuses an extra key (`subject: "x"`) and a negative count.
3. `statsQuerySchema.parse({})` → `{ weeks: 8 }`; `{ weeks: "13" }` → error.

**Check.** `bun test packages/core/src/metrics/ packages/core/src/web/stats.test.ts`

**Done when.** Cases 1–3 pass.

**Out of scope.** The readers and the service (stages 10–12).

## Done when (stage)

Steps 1–3 done; the Proof command of `plan.md` passes (`/tmp/f100-s09`).
