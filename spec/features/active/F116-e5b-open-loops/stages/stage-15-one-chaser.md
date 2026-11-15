# F116 stage 15 — One chaser

Part of [`../plan.md`](../plan.md). `[risky]` (sending to people, a job that replaces a running one). Needs stage 14. Edits the job list in `main.ts`: merge `master` first.

## Step 1 — The job takes over

- **Goal:** `loops.chaser` replaces the `delegation.chaser` registration (D3). The schedule (`20 */15 * * * *`), the 07:30 local gate and once per local day per mailbox stay.
- **Decisions:**
  - Module `delegation` keeps the delegation rules and exports them as two parts: `planDelegationReminders(trx, ctx, mailboxId, { now, limit })` (marks overdue, returns the planned reminder pairs) and the set creation it uses today. `runChaserForMailbox` becomes a thin wrapper, so its tests stay.
  - `runLoopChaser(deps, ctx, mailboxId, { now, force })` runs, in one transaction after the settings share lock and the version compare (M13): the delegation part, then the loop part (step 2), then one approval set for the delegation reminders (as today). Loop follow-ups never join a set (review G6): each is its own card (stage 11). At most 10 planned sends per mailbox run in total, delegation reminders first; the rest waits for the next day. One `loops.chaser_run` audit row (counts only); the delegation part keeps writing `delegation.chaser_run`, so its once-per-day rule is the same.
  - `job:run --name loops.chaser [--force]`; `--name delegation.chaser` runs the same job and prints one line that the name is an alias.
  - Log line `loops_chaser_done` (`mailbox_id`, `count` planned, `kind` = `stale` / `expired` counts as separate lines).
- **Test (integration, fixed clock Warsaw):** T1 at 07:29 → nothing; at 07:31 → one run; a second tick the same day → nothing; with `--force` → runs; T2 two overdue delegations and one due delegated loop → one set of 2 reminders and one follow-up card; T3 12 candidates → 10 planned, 2 the next day; T4 the existing `delegation-chaser.test.ts` cases pass through the new job.

## Step 2 — The loop part (D13)

- **Goal:** the daily loop rules.
- **Decisions:**
  - (a) `delegated` loops with `due_at <= now`, open, no waiting follow-up, `follow_ups_sent < 2`, 3 working days since the last, not suspicious: a follow-up pair (the stage 14 planning core, actor `system`) in the set. Only in `assist` with `create_draft` on.
  - (b) `waiting` loops: the same, only when `tool_switches.auto_follow_up` is on (PD-120, default off).
  - (c) `stale`: an open `waiting` or `delegated` loop with `follow_ups_sent = 2` and `last_follow_up_at + 14 days <= now`, or any open one with `due_at + 30 days <= now` (an ignored loop ends, review G5, questions.md 17) → `closed` / `stale`. All modes.
  - (d) `expired`: an open `promised` loop with `due_at + 7 days <= now` → `closed` / `expired`. All modes.
  - Gates (review G14): today's job skips a mailbox that is not `assist` with drafts on before any work. The new job visits every mailbox of an org with `open_loops` on (and, as today, every mailbox for the delegation part); the delegation part, (a) and (b) keep the `assist` and drafts gate; (c) and (d) run in every mode. Shadow: (a) and (b) plan nothing; the brief says "would draft a follow-up" (stage 18).
  - A disabled delegate: (a) skips the loop (like today's reminders).
- **Test (integration):** T5 a delegated loop due yesterday in `assist` → one follow-up in the set, To = the delegate; T6 a waiting loop due yesterday with `auto_follow_up` off → nothing; on → one follow-up; T7 shadow → nothing planned, no action rows; T8 2 follow-ups, the last 14 days ago → `stale`; 13 days → open; no follow-up and due 30 days ago → `stale`, 29 days → open; the same in shadow mode → `stale`; T9 a promised loop due 2026-11-13 17:00, now 2026-11-20 17:01 → `expired`; T10 a disabled delegate → skipped; T11 the settings version changes during the run → the run writes nothing (M13).

## Check

`bun test apps/server/test/integration/delegation-chaser.test.ts apps/server/test/integration/<the new chaser tests>`

## Done when

T1–T11 pass; `docs/capabilities/delegation.md` § Entry points names the new job (one line; stage 24 does the full docs); the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s15`).

## Out of scope

Brief lines (18), routes (20).

## Carry-over from stage 11 (worker, 2026-11-15)

- One card per follow-up: a follow-up never joins an approval set (the set readers are mail-only and the send payload refuses `set_id`). The chaser queues no set for loops.
- Cards go only to owners whose consent covers loop data (`loopConsentOf`); an uncovered owner gets one `loop_consent` line per day. Details: `notes/2026-11-15-f116-stage-11-follow-up-cards.md`.
