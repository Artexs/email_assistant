# Coordinator handoff (written 2026-11-14 before the owner compacts the chat)

Standing owner orders: builders no cap; planners max 3; VPS, ssh and deploy are pre-approved (backup first, name the rollback, verify after); checkpoints and owner steps are not a stop; only a missing API key stops me; use plan defaults; first reply line is the answer; plain English; end with an overview.
Order rule: plan a ticket only after the tickets it needs have landed (see spec/build.md Planning lines).

Steps after the owner says "start":
1. Set a wake rule at the quota reset (12:00 Warsaw) plus 2 min: `limen rule set noon-resume --until "2026-11-14 12:02" "..."`. Resume only after 12:00.
2. Resume the failed jobs (`limen continue <id> --engine pi --provider claude-bridge --model <m> --thinking high --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge "<msg>"`): F095 stage 08 build (2026-11-14-f095-s08-778b34cc), review of F095 stage 07 (2026-11-14-f095-review-s07-c3742646; or spawn a new review of branch limen/2026-11-14-f095-s07-cc53288f), planners F101 (2026-11-14-f101-plan-astro-7-f9a673cd; its review job failed; B1 of that review: stage 04 check 7 baseline), F103 (2026-11-14-f103-plan-e8a-logs-fd4a9f85). Hold F102 (2026-11-14-f102-plan-e4-a-db8911dd): finish after F098 and F101 are built, then a planner re-checks it against the new code.
3. Plan F092 (RLS) now with the review's default (yes, include).
4. Build in order: F095 stages 07 to 10 (stage 10 needs the owner U1 phone session), then F097, F098, F099, F100 builds (each after F095 closes; F100 stage-level waits on F097 stages 01, 03, 04).
5. Old unblocked tickets that need a plan: F029+F032+F064 (one ticket), F062, F068, F085.
6. 2026-11-15 01:10: rule f094-next-day: the next-day VPS check, then `limen ticket done F094`.
7. Land rules: `limen land <done job id> --yes [--keep-open]`; if the continue job has no commits, merge the parent branch by hand (`limen ticket check`, `git merge --no-ff`), then `limen ticket done FNNN`. Read the land output before closing a ticket. For history-merge branches, land only when master equals the branch base.
8. Notes with follow-ups: notes/2026-11-13-s2-foundation-followups.md. State summaries: notes/2026-11-14-overnight-summary.md, notes/2026-11-13-stage-2-foundation-state.md.
