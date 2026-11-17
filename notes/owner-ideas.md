# Owner ideas: short notes to pick up later

One place for harness ideas that the owner parked or must decide. One entry each: what, why, status. Newest first. Agents append here; the owner decides. Detail: `notes/2026-11-15-limen-unused-features.md`.

## Limen start settle 60 s → 10 s · done 2026-11-15
- File `~/.limen/start-gate.json` = `{ "settle": "10s" }` (seat-wide, outside the repo). `limen queue` shows `settle 10s`.
- Why: 60 s between job starts caused almost all queue waits (only 10 of 552 readings had low CPU).
- Undo: delete the file.

## Project reminders file · idea, not done
- Limen copies `.agents/limen/reminders.md` into the first prompt of every job: worker, reviewer, planner, scout. The coordinator does not get it.
- Use: move the lines the coordinator types into almost every task, for example "Never use limen wait; no tool call over 120 s; never kill processes by name…" (29 of the last 30 tasks), "Commit by explicit paths", the stale `node_modules` fix.
- Only rules that hold for every role. It cannot run commands (no use for compaction).

## Retire old job records · parked
- `limen prune --retire` would delete 576 of 587 records (332 MB). No real speed gain: `limen jobs` 0.26 s, `limen status` 1.3 s.
- Unfiled reviewer verdicts live only in those records. File them first if they matter.

## Priority budget · idea
- Jobs have priority 1–3 (all run at 2 now). A rule `limen rule set claude-week --until <reset> --start-priority 1 "…"` lets only priority 1 jobs start; the others wait and start after the rule ends.
- Needs a TRACK line first that says which jobs get 1, 2 and 3.

## Quality pass · on, 2026-11-15
- Every 10 landed tickets, the coordinator starts a cleanup check of merged code; its findings become new tickets (rule: `spec/build.md` TRACK, Standing models).

## Phone alerts · open question
- Moshi or ntfy ping for failed jobs and stops. Setup: Limen `docs/seat/README.md`.
