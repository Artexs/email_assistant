# Limen planning jobs (planner role)

- Limen F069 lets a project add a job kind: `limen spawn --role <name>` loads `.agents/limen/<name>.md` (resolver: limen `src/commands/spawn.ts` resolvePreamble). No Limen code change needed.
- This repo now has `.agents/limen/planner.md`: a detached job that runs the `plan-task` method on one existing ticket, with no owner questions (defaults go to `questions.md`), no nested spawn, commits only its ticket folder.
- Spawn (Opus plans, Sonnet builds):
  `limen spawn --role planner --engine pi --provider claude-bridge --model claude-opus-5-5 --thinking high --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge --label "plan · FNNN" "Plan FNNN: write stages/ for spec/features/planned/FNNN-slug/"`
- No `--prepare` needed: planning uses no DB.
- Review (owner decision 2026-11-13: not the coordinator's work): the planner job commits the plan, starts its own `--review --branch <own branch>` job (Opus 5.5, high, fresh context; owner decision 2026-11-13, was Sonnet), waits, files `plan-review-1.md`, fixes the findings, commits. The coordinator only starts the planner and lands it. Spawn the planner with `--timeout 3h`, so the review fits in its deadline.
- Alternative for a high-risk ticket: `limen group start <ticket> --team <Opus> --team <other model> --rounds draft,critique,revise,final` (docs/groups.md in the limen repo). Two independent plans, cross critique, one merged result. Needs the interactive coordinator pane as lead.
- Not verified: a job's nested `limen spawn --review` on its own branch. Limen does not refuse spawn under LIMEN_JOB=1 (only `group start`), but no run has proved it.
- Trap: a job worktree starts from HEAD. Uncommitted ticket folders do not exist there. Commit the ticket folder first.
- Limit: plan-task §2 (ask the owner before stages) is lost in a detached job. Fit: tickets whose plan.md already holds the decisions. For a ticket with open product choices, use an interactive session or `--tab`.
- Status 2026-11-13: preamble written, not yet tried in a real spawn.

## Questions and order (owner decision 2026-11-13)
- Product questions for the Stage 2 epics are answered. A planning job only turns decisions into stages.
- Small question: default plus `questions.md`. Blocking question: the job sets `needs-adam` in the ticket front matter (Limen shows it in `limen status` as "needs a decision"), commits, finishes. The coordinator asks the owner, then `limen continue <job> "<answer>"` resumes the same session with full context. A job never waits in a running state for an answer.
- Order: Limen has no dependency field. `## Sequenced` holds `Plan after:` and `Build after:`. The coordinator reads them on each turn. A job finish wakes the coordinator, and that is when it starts the next item.
- Earlier proposal (superseded by the rule below):
  "Planning: start a `--role planner` job for the first NEXT ticket that has no `stages/` and whose `Plan after` tickets all have `stages/`. At most three planner jobs at once. Land it into `planned/`, give the owner the summary and `questions.md`. A ticket builds only after the owner says `Build FNNN` and its `Build after` tickets are in `done/`."

## Coordinator rule (in force 2026-11-13; one-line pointer in `spec/build.md` NEXT)
- Spawn: `limen spawn --role planner --engine pi --provider claude-bridge --model claude-opus-5-5 --thinking high --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge --timeout 3h --label "plan · FNNN" "Plan FNNN: write stages/ for spec/features/planned/FNNN-slug/"`
- At most three planner jobs at once. F091 plans after F088 and F090 have `stages/`. F092 waits for the owner (`needs-adam`).
- The job runs its own cold review. The coordinator lands it with `limen land`.
- A job that ends with `needs-adam` set: ask the owner, then `limen continue <job> "<answer>"`.
- Auto-build (owner decision 2026-11-13): a plan that lands with no `needs-adam` builds without a new owner OK once its `Build after` tickets are in `done/`. Send the owner the plan summary and the `questions.md` defaults. Stop at the owner checkpoints the plan names.

## Trigger (owner question 2026-11-13; replaces "plan.md without stages/")
- Only a NEXT line in `spec/build.md` that says `needs plan` starts a planner job. Whoever adds the ticket writes it there.
- Why: 30+ old tickets in `planned/` have a `plan.md` that is a full one-job task file and no `stages/`. The folder test would have planned them again.
- Not in the ticket: Limen's strict check refuses unknown front matter fields, and its rules forbid status lines in a ticket body. The board is coordinator prose, so a state word there is allowed.
- Three cases: `needs plan` → planner job; `stages/` → one worker job per stage; neither → one worker job from `ticket.md` (+ old `plan.md`).
