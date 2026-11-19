# F116 stage 23 — M2 counts loops

Part of [`../plan.md`](../plan.md). Needs stages 10 and 13. No migration.

M2 today counts delegations only (`packages/core/src/metrics/m2.ts`, F4). PD-127: two numbers, surfaced on time and closed on time, now over all three loop kinds and delegations.

## Step 1 — Rows and the rule (core)

- **Goal:** `LoopDueRow` and `openLoopsOnTime` over delegations and loops, with a per-kind split.
- **Interfaces:** `LoopDueRow { id, kind: "waiting" | "promised" | "delegated", dueAt, surfacedAt, closedAt, closeReason, firstFollowUpAt }`; `openLoopsOnTime(rows: { delegations, loops }, opts)` → today's `OpenLoopsOnTime` plus `byKind: Record<"delegation" | LoopKind, OpenLoopsOnTime>`. The totals are the sum of the kinds.
- **Decisions (default, questions.md 14):**
  - A loop counts in the week of its `due_at` (the current due; a Later tap moves it).
  - Left out: `dropped`, `untracked`, `sent_off` (the user said it is no loop, or withdrew consent).
  - Closed on time: closed `replied`, `replied_subject`, `done` or `later_reply` by due + 1 working day, or a follow-up applied by then (`firstFollowUpAt`; the M2-closed rule of discovery notes §5a).
  - Surfaced on time: closed on time, or `surfaced_at` by due + 1 working day.
  - `stale` and `expired` count as due and not closed.
  - Pending: as today (deadline in the future and not closed).
- **Test (unit, Warsaw):** T1 a waiting loop due Mon 2026-11-23 17:00, replied Tue 11-24 10:00 → closed and surfaced on time; T2 the same replied Wed 11-25 10:00 → not closed; `surfaced_at` Mon 08:00 → surfaced; T3 a dropped loop → not counted; T4 a stale loop → due 1, closed 0; T5 a follow-up applied Tue 11-24 → closed on time; T6 `byKind` sums to the totals; T7 today's delegation fixtures give today's numbers.

## Step 2 — Readers and the report

- **Goal:** `loopDueRows(db, ctx, { range })` in `loops` (the first follow-up time from the loop's applied sends); `weekStats` reads it; the stats route, `stats:week` and the weekly report show the totals and the split.
- **Decisions:** the CLI prints one more `key value` line per kind (`m2_waiting due 3 closed 2 surfaced 3 pending 0`); the panel stats table gets one row per kind under M2, only when the org has `open_loops` on; the weekly report keeps its lines and adds "of which loops: …" when loops exist. The metric reads real mail only (synthetic mailboxes are out, as today).
- **Test (integration):** T8 `weekStats` with one delegation and two loops → totals and `byKind`; T9 `stats:week` prints the new lines and no address; T10 an org with the flag off → no loop lines.

## Check

`bun test packages/core/src/metrics apps/server/test/integration/<the touched stats tests>`

## Done when

T1–T10 pass; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s23`).

## Out of scope

The E2b week scorer (it calls `weekStats`; stage 25 reads its result).
