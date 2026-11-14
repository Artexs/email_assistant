# F097 stage 07 — Week planner and prior history

Part of [`../plan.md`](../plan.md).

After this stage the planner also returns the realistic week: 830 incoming mails over 7 days with the planned mix, threads over days, delegate behaviours for E2b, executive-started threads for E5, and a 30-day prior history per sender (D19, X3, X4).

## Step 1 — Week spec and the day plan

**Goal.** The counts per day and category are exact and deterministic (D19).

**Files.** `packages/core/src/sim/plan-spec.ts` (add `week`), `packages/core/src/sim/plan-week.ts` (new), `plan-week.test.ts` (new).

**Interfaces.**

```ts
week: z.object({
  weekdayMails: z.number().int().positive(),   // 150
  weekendMails: z.number().int().min(0),       // 40
  mix: z.object({ notification: z.number(), spam: z.number(), info: z.number(), needs_reply: z.number(), delegation: z.number(), urgent: z.number() }).strict(), // 0.35 0.20 0.20 0.13 0.07 0.05, sum 1 ± 1e-9
  langShare: z.object({ pl: z.number(), en: z.number() }).strict(), // 0.7 / 0.3
  replyShare: z.number().min(0).max(1),        // 0.3 of person mail is a reply in a thread
  maxThreadDepth: z.number().int().min(1).max(10), // 5
  sentThreadsPerWeekday: z.number().int().min(0),  // 3
  offHoursShare: z.number().min(0).max(1),     // 0.05
  behaviour: z.object({ done: z.number(), late: z.number(), out_of_office: z.number(), other_address: z.number(), silent: z.number() }).strict(), // 0.40 0.20 0.15 0.10 0.15
  historyDays: z.number().int().positive(),    // 30
}).strict(),

export function dayCounts(spec: WeekSpec): { day: number; total: number; byCategory: Record<ValueCategory, number> }[]; // 7 entries
export function planWeek(scenario: Scenario, spec: PlanSpec): { slots: Slot[]; history: WeekHistory };
export const weekHistorySchema = z.object({ scenario: z.string(), days: z.number().int(), senders: z.record(z.string(), senderHistorySchema) }).strict();
export type WeekHistory = z.infer<typeof weekHistorySchema>;
```

`dayCounts`: day 0–4 total `weekdayMails`, days 5–6 `weekendMails`; per day, the mix by largest remainder (ties broken by the order `notification, spam, info, needs_reply, delegation, urgent`). The 7-day sums are reported in the test, not forced to a weekly target.

**Decisions.** D19.

**Test.**

1. Default spec → totals `[150,150,150,150,150,40,40]` (830).
2. Weekday 150 (`notification, spam, info, needs_reply, delegation, urgent`): exact shares 52.5, 30, 30, 19.5, 10.5, 7.5; floors sum 148; the two extra go by the tie order to notification and needs_reply → `[53, 30, 30, 20, 10, 7]`. Weekend 40: 14, 8, 8, 5.2, 2.8, 2 → floors 39; the largest remainder (0.8) → delegation → `[14, 8, 8, 5, 3, 2]`. Ties are broken by the order only among equal remainders.
3. A mix that sums to 0.99 → the schema refuses it.

**Check.** `bun test packages/core/src/sim/plan-week.test.ts`

**Done when.** Cases 1–3 pass.

## Step 2 — Week slots

**Goal.** Each planned mail of the week is a slot with a time, a thread and the facts E2b needs (D19, X4).

**Files.** `packages/core/src/sim/plan-week.ts`, `plan-week.test.ts`.

**Interfaces.** `planWeek` builds slots with `part: "week"`, ids `w-<day 1–7>-<nnn>`, `threadId` and `parentId`, sorted by `receivedAt` and batched by 25 in time order (`batchSlots`).

Rules (seed streams `deriveSeed(seed, "week:<day>")`):

1. Categories per day from `dayCounts`; senders by the stage 06 group rule; urgency sources 50/25/25 within the week's urgent slots; language 70/30 by largest remainder over the week.
2. Times: weekdays uniform in 07:00–20:00 Europe/Warsaw for `1 − offHoursShare`, the rest in 20:00–23:59 or 05:00–06:59; weekend days uniform 08:00–22:00. `localToInstant` for the UTC time. No two slots at the same minute (shift by one minute on a clash).
3. Threads: `replyShare` of person-sent slots (groups boss, team, client, partner, vendor, delegate) reply to an earlier slot of the same week with the same topic, between the same two people (the executive is always one end); `parentId` = the earlier slot, `threadId` = the root's id; depth ≤ `maxThreadDepth`; a parent is at least 10 minutes earlier.
4. Executive-started threads (X4): `sentThreadsPerWeekday` slots per weekday with `direction: "sent"`, `persona` = the executive key, `to` = a person; category `info` (the label is not scored: E5 scores these later); 2 of 3 get a planned reply slot 4–48 h later (category `needs_reply` or `info`), 1 of 3 gets none (the dropped-thread case). These come on top of the 830 incoming mails.
5. Delegation slots get `delegateBehaviour` by the `behaviour` shares (largest remainder over the week's delegation slots, then shuffled), plus `expectedDraft` and `expectedDelegate` like the bank.
6. Hard cases in the week: 1 of each `phishing_*` tag per weekday (P14), replacing a `spam` slot of that day; 2 `auto_reply` and 1 `bounce` per weekday replacing `notification` slots; all other tags are bank only.
7. Headers and style as in stage 06.

**Decisions.** D19, P14, X4.

**Test** (`miniScenario`, spec with `weekdayMails: 20, weekendMails: 6`, the default shares, `sentThreadsPerWeekday: 1`, seed 5):

1. Determinism: two calls are `JSON.stringify` equal.
2. Incoming slot count = 112; `sent` slots = 5; planned replies to sent threads (`parentId` → a `sent` slot) between 3 and 5 (assert the exact pinned value).
3. Every `parentId` points to an earlier slot (≥ 10 min) of the same `threadId`; no thread is deeper than 5.
4. Every slot of day d has a local date `weekStart + d − 1` in Europe/Warsaw; at most `ceil(0.05 × weekday count) + 1` weekday slots per day are outside 07:00–20:00.
5. Every delegation slot has a `delegateBehaviour`; the counts over the week follow the shares by largest remainder.
6. Each weekday has one slot of each `phishing_*` tag.
7. Batches are in time order: the last `receivedAt` of `batch-00k` ≤ the first of `batch-00k+1`.

**Check.** `bun test packages/core/src/sim/plan-week.test.ts`

**Done when.** Cases 1–7 pass.

## Step 3 — Prior history

**Goal.** The week starts with a 30-day history per sender, counts and flags only (D9, X3).

**Files.** `packages/core/src/sim/plan-week.ts`, `plan-week.test.ts`.

**Interfaces.** `planWeek(...).history`: one `SenderHistory` with `days: spec.week.historyDays` per persona that sends at least one week slot, keyed by persona address; from `senderHistoryFor` (stage 06) with `days = 30`. Phishing and spammer personas get `received: 0`, `relation: "new"` (they are new in the week).

**Decisions.** D9, X3.

**Test.**

1. `weekHistorySchema` parses the result; every sender address of an incoming slot is a key.
2. Every phishing persona has `received: 0` and `relation: "new"`.
3. JSON of the history contains no persona `voice` text and no `displayName` (assert with `includes` on each).

**Check.** `bun test packages/core/src/sim/plan-week.test.ts`

**Done when.** Cases 1–3 pass.

**Out of scope.** The injector and delegate bots that use these facts (E2b, F113).
