# F068 questions for the owner

Defaults taken by the planner (2026-11-19). None blocks the build.

1. [minor] **Close every representable latent edge (plan D7).** The old task made the closure optional. Default: close all 18 rows (70 moves) in stage 02; no caller uses one (plan § Facts checked). Undo: put the rows back in `WRITER_GUARDS`.
2. [minor] **Leave L8 open (plan D8).** An original draft can still go `ready → applied` or `ready → failed` through `finishAction`, because the map cannot tell an original row from a reverse row. Default: keep it and record it in a test and a comment. Other option: a `reverse` field in the map (more map and test change for one unused move).
3. [minor] **Old open points stay out (plan D11).** The `PAIR_RULES` test-name link, a map field for `reverses_action_id`, `status_reason` and boundary tests, the other state machines. Default: not in this ticket.
4. [minor] **A brand-new writer is still caught only by the written rule (plan D13).** No source scan (repository rule) and no trigger (no migration). Default: the rule in `docs/code-patterns.md` § Data access names `statusGuard`.
