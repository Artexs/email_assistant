# Tasks

All work in this repo is a task file here. One Markdown file per task: `tasks/<state>/<name>.md`.
A new session reads `active/` first. The `done/` folder is the history of the work done in the project.

## Folders

- `planned/` — next work, in rough priority order. Short files: goal, scope, done-when.
- `active/` — the work in progress now. Keep this small (normally 1–2 files).
- `done/` — finished tasks, kept for reference. Do not edit them later, except to fix links.

Move a file between folders with `git mv` when its state changes.

**Blocked tasks.** A task that must not start before a time or an event has the status `blocked until <UTC time or event>`
and a `> **Blocked until:**` line under the status with the reason and what an agent may do before then.
Before you pick a task, read its status line. Check `date -u`. Do not start a blocked task before its time, and tell the user when it opens.

## Where each fact lives (one source per fact)

| Place             | Holds                                                                  | Does not hold                         |
| ----------------- | ---------------------------------------------------------------------- | ------------------------------------- |
| `docs/`           | The product and architecture as they are now + the target design, ADRs | Steps, status, logs                   |
| `docs/roadmap.md` | Slice list: order, content, size, dependencies, link to the task file  | File-level plans, status              |
| `tasks/`          | The work: goal, scope, done-when, file-level plan, status, log         | Stable decisions (they go to `docs/`) |
| `notes/`          | Facts learned that a later agent needs and that are not a task         | Plans                                 |
| `.ai/`            | History (2025 docs)                                                    | Decisions                             |

## Life of a task

1. **Create.** When the user asks for a task or a plan, create `planned/<name>.md` from the template below.
   If the user wants to start now, create it in `active/` directly.
2. **Start.** `git mv` the file to `active/`. Write the file-level plan in the file before you change code.
   Set the status line to `in progress`.
3. **Work.** Tick the plan steps. Add one log line per session (date, what was done, what was decided).
   Update the status line before each commit that changes the task.
4. **Finish.** Do the done-checklist. Set the status to `done`, then `git mv` the file to `done/`.
   Ideas that came up and are not done go to new files in `planned/`.

## How to run a slice

Big tasks (the slices S0–S6 in `docs/roadmap.md`) run in a plan → build → review loop in pi.
Start it with `/skill:run-task tasks/planned/<name>.md`. The skill (`~/.pi/agent/skills/run-task/`) holds the full procedure.
Each subagent uses the model of its agent file (`~/.pi/agent/agents/`). A task file can name other models for some stages (example: a "Review model" section); only then the main session sets a model.

| Who                           | Model                                                           | Does                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Main session (you talk to it) | Opus                                                            | Calls the subagents, checks their work, asks the user, commits each stage                                                     |
| `planner` subagent            | Opus, medium                                                    | Adds step detail to the approved stages in `## Plan` (files, interfaces, tests, checks). Never makes the plan                 |
| `implementer` subagent        | Sonnet, medium                                                  | Builds one step: test first, code, checks. Never commits                                                                      |
| `reviewer` subagent           | Sonnet, high (other models only where the task file names them) | Reviews one stage, runs the checks, gives PASS or FAIL. Read-only. Group review at each user checkpoint (else every 5 stages) |

The subagents are global: `~/.pi/agent/agents/*.md`, via the extension in `~/.pi/agent/extensions/subagent/`.

1. **Plan.** The user and the main session write the stages in `## Plan`. **The user approves them.** The planner adds the step detail. **The user answers its questions.** The main session commits the plan.
2. **Build.** The implementer builds each step of a stage. The changes stay uncommitted.
3. **Review.** The reviewer checks the stage. On FAIL, the implementer fixes the findings (max 2 rounds, then the user decides).
4. **Commit.** On PASS, the main session ticks the steps, adds a log line, and commits and pushes the stage (rules in `CLAUDE.md`).
5. **End.** **The user tries the result.** The main session closes the task.

Plan shape: stages of 1 `[risky]` step or 2–4 normal steps (about 300 changed lines or less). Each step has Goal, Files, Interfaces,
Decisions, Test, Check, Done when, Out of scope. `[risky]` areas: data integrity, sync and dedup, exactly-once, security, auth, tenant
isolation, sending to people, LLM prompts and evals, migrations.

**Big plans: one file per stage.** When a plan has more than about 15 stages, keep the task file small (status, goal, done when,
input, rules, checkpoints, a stage list with one box per stage, results, log) and put each stage in `tasks/<state>/<name>/stage-NN-<slug>.md`.
Each subagent call then reads the task file and one stage file, not the whole plan. Tick the steps in the stage file and the stage box
in the task file. Move the folder together with the task file (`git mv`). Example: `tasks/active/s1b-shadow-triage/`.

### Pipeline mode (user decision 2026-11-07)

The implementers run one after the other and do not wait for the reviews. The reviews run at the same time, each on a frozen copy.
This mode replaces steps 2–4 above when the task file says `Run mode: pipeline`. The planner step and the user checkpoints do not change.

1. **Build.** The implementer builds the steps of stage N in the main checkout. The main session then runs `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
2. **Local commit.** All checks pass → the main session ticks the steps, adds a log line `stage N built, review pending`, and commits the stage files by explicit path. Body: `Review: pending`. No push.
3. **Review (background).** The main session makes a read-only copy: `git worktree add --detach ~/.cache/ea-review/stage-N <sha>` (no branch), then `bun install` there. It starts the reviewer in the background: `~/.pi/agent/bin/bg-agent.sh reviewer ~/.cache/ea-review/stage-N ~/.cache/ea-review/stage-N.md "<task>" [model] [thinking]`. Scope: the commit range `<sha>^..<sha>`. In the worktree the reviewer runs only lint, typecheck and unit tests. The dev DB is shared, so `test:int` runs only in the main checkout, by the main session.
4. **Next stage at once.** The implementer for stage N+1 starts right after the local commit of stage N. It does not wait for the review.
5. **Review result.** After each implementer, the main session checks `~/.cache/ea-review/*.md.done`.
   - PASS → push the stages up to the first stage that is not yet PASS, in stage order (`git fetch`, `git log HEAD..origin/master` first). Remove the worktree (`git worktree remove`).
   - FAIL → the fix for stage N is the next implementer job (before stage N+2). The main session commits the fix locally: `<area>: <slice> stage N fix — <what>`. Then a new background review of the fix commit runs. Max 2 FAIL rounds per stage, then stop and ask the user.
   - A finding that changes an interface or a decision that later stages use → stop the pipeline. Fix stage N, then check the later local commits before the next stage.
6. **Limit: 2 stages ahead.** The implementer of stage N+2 starts only after stage N has PASS. Example: stages 10 and 11 are built, and the stage 10 review is not done → the main session waits for it before it starts stage 12. Why: a review can change stage N, and the stages after it build on it. The limit keeps the redo small.
7. **Never** rewrite a commit, force-push, or push a stage before its PASS. A group review at a checkpoint runs after all stages of its range have PASS.

### Git mode (user decision 2026-11-07)

A task file names its mode in a line `Git mode: worktree` or `Git mode: master`. No line: `worktree` for a task with stages (the `run-task` loop), `master` for a small change (docs, notes, task files). Exception: the tasks that were already in progress on `master` when this rule came (S3, S4, `test-mail-traffic`, 2026-11-07) stay on `master`. Rules in `CLAUDE.md`.

A worktree is a second folder of the same repository with its own branch. Its commits go into the same `.git` store at once, so the main checkout sees the branch too. The folder and the branch stay on disk after a crash or the end of a session. To resume, open the folder again. Uncommitted changes exist only in that folder until a commit and a push.

- **`master`:** commit in the main checkout and push to `master` with a standard `git push`.
- **`worktree`:**
  1. Create (or, to resume, reuse the folder if `git worktree list` shows it): `git worktree add ../email_assistant-wt/<name> -b task/<name> origin/master`. Copy `.env` from the main checkout (never commit it), then run `bun install`.
  2. Work: commit the stages on the branch, and push with `git push -u origin task/<name>`. To get new `master` work, run `git merge origin/master` in the branch. Never rebase a pushed branch.
  3. Merge: at the end of the task (or at a user checkpoint), run `git merge origin/master` in the branch, and the checks must pass. Then the main checkout runs `git merge --no-ff task/<name>` on `master` and pushes.
  4. Clean up: `git worktree remove ../email_assistant-wt/<name>`, `git branch -d task/<name>`, `git push origin --delete task/<name>`.
- **Both modes:** stage only your own files by explicit path. Worktrees share the runtime: the dev DB, GreenMail and the ports in `.env`. For an own database, run `bun run db:worktree <name>` and use the two printed env lines; drop it with `--drop` at the end. Only one checkout runs `bun run test:int`, `db:migrate` or a dev server at a time. Only one task at a time adds a DB migration or changes `bun.lock`.
- The detached review copies in `~/.cache/ea-review/` (§ "Pipeline mode") are not task worktrees: they never commit.

## Template

```markdown
> **Status YYYY-MM-DD — planned | in progress | code done, deploy left | done.** <what is left>

# <Title>

Scope: <link to docs/roadmap.md row or other source>. Needs: <tasks that must be done first>.

## Goal

<one or two sentences>

## Done when

- <check that can be tested>

## Plan

<written when the task starts: files to change, steps, tests>

- [ ] step

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- YYYY-MM-DD: <what was done or decided>
```
