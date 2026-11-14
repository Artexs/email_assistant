# Overnight summary, 2026-11-14 (Warsaw time)

## Time windows
- Window 1: 01:35 to 02:40 (about 1 h 05). The 5-hour limit hit at 02:39. Eight jobs failed within one minute. The limit window ran 01:30 to 06:30.
- Idle: 02:40 to 07:00. The limit reset at 06:30. The morning wake rule fired at 07:00, so 30 minutes were lost.
- Window 2: 07:00 to 07:49 (about 50 min). The limit hit at about 07:45. Six jobs failed on it. The next reset is 12:00.
- Productive time: about 1 h 55 min of 8 hours. Cause: 5 to 7 parallel jobs, many on Opus (planners and reviewers), burn the quota in about an hour.

## Jobs started in the two windows: 54
| Kind | Window 1 | Window 2 | Total | Done | Failed |
| --- | --- | --- | --- | --- | --- |
| Builds (stages, fixes, resumes) | 14 | 8 | 22 | 19 | 3 |
| Planning sessions | 6 | 6 | 12 | 6 | 6 |
| Plan reviews (cold) | 5 | 4 | 9 | 6 | 3 |
| Stage reviews (Opus) | 6 | 5 | 11 | 9 | 2 |
Failures: 11 on the quota limit (0 tool calls in most); 1 build killed itself with `pkill -f` (F091 stage 04, resumed and landed).

## What landed
- Window 1: F091 stages 01 to 03 (actions and mail repos split, history kept; a redo of the mail split fixed `--follow`), F095 stage 01, F096 build (log rotation), F094 stage 1 (Bun 1.4.4), F088 stage 07 (F088 closed), F030, F078, the F095 and F097 plans. VPS: one update from cab134f to d117cd6 (S6b, Bun 1.4.4, F086 to F090, F093; 3 migrations; every check held), then a second update to 2edbfef with log rotation.
- Window 2: F091 stages 04 and 05 (F091 closed), F095 stages 02 to 06, the F098, F099 and F100 plans.
- Tickets closed in the two windows: F030, F078, F088, F091, F096 (and F082 after the VPS update).

## State of the Stage 2 foundation group (8 epics)
Closed: F086, F087, F088, F089, F090, F091, F093 (7 of 8). F092 (RLS) waits for the owner's yes to plan it.

## State of the Stage 2 roadmap (28 tickets, F095 to F122)
- Closed: F096.
- Plan landed, build waits or runs: F095 (6 of 10 stages landed; 07 reviewed pending; 08 failed on quota), F097 (22 stages), F098 (13), F099 (15), F100 (19).
- Plan written, not landed: F101 (4 stages, cold review failed on quota), F102 (20 stages, no review yet), F103 (planner failed on quota, no stages).
- Not planned: F104 to F122 (19 tickets).

## Backlog
- Ready stages: F095 4 left, F097 22, F098 13, F099 15, F100 19 = 73 stages (plus reviews).
- Plans to finish or start: F101, F102, F103, F104 to F122 = 22.
- Old tickets: 15 in planned/ (mostly blocked by time or another ticket, see spec/features/planned/triage-2026-11-13.md). F092 waits for the owner.
- Active besides: F069 (needs one panel sign-in), F071 (Limen transition), F094 (stage 2 next-day VPS check, rule `f094-next-day` on 2026-11-15 01:10).

## Failed jobs to resume after the reset (12:00)
F095 stage 08 build, the review of F095 stage 07, planners F101 (and its review), F102, F103. Resume with `limen continue` and the claude-bridge flags.

## Lessons
- Set the wake rule at reset time plus 2 minutes (not later).
- The quota allows about 1 hour of work with 5 to 7 jobs in parallel. Fewer parallel Opus jobs would stretch each window.
