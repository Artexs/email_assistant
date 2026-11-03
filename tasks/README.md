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

| Place | Holds | Does not hold |
|---|---|---|
| `docs/` | The product and architecture as they are now + the target design, ADRs | Steps, status, logs |
| `docs/roadmap.md` | Slice list: order, content, size, dependencies, link to the task file | File-level plans, status |
| `tasks/` | The work: goal, scope, done-when, file-level plan, status, log | Stable decisions (they go to `docs/`) |
| `notes/` | Facts learned that a later agent needs and that are not a task | Plans |
| `.ai/` | History (2025 docs) | Decisions |

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
Start it with `/skill:run-slice tasks/planned/<name>.md`. The skill (`~/.pi/agent/skills/run-slice/`) holds the full procedure.

| Who | Model | Does |
|---|---|---|
| Main session (you talk to it) | Opus | Calls the subagents, checks their work, asks the user, commits each stage |
| `planner` subagent | Opus, high | Writes the `## Plan` in the task file: stages, steps, questions for the user |
| `implementer` subagent | Sonnet, medium (Opus, high for `[risky]` stages) | Builds one step: test first, code, checks. Never commits |
| `reviewer` subagent | Opus, high | Reviews one stage, runs the checks, gives PASS or FAIL. Read-only |

The subagents are global: `~/.pi/agent/agents/*.md`, via the extension in `~/.pi/agent/extensions/subagent/`.

1. **Plan.** The planner writes the plan. **The user answers its questions and approves the plan.** The main session commits the plan.
2. **Build.** The implementer builds each step of a stage. The changes stay uncommitted.
3. **Review.** The reviewer checks the stage. On FAIL, the implementer fixes the findings (max 2 rounds, then the user decides).
4. **Commit.** On PASS, the main session ticks the steps, adds a log line, and commits and pushes the stage (rules in `CLAUDE.md`).
5. **End.** **The user tries the result.** The main session closes the task.

Plan shape: stages of 1 `[risky]` step or 2–4 normal steps (about 300 changed lines or less). Each step has Goal, Files, Interfaces,
Decisions, Test, Check, Done when, Out of scope. `[risky]` areas: data integrity, sync and dedup, exactly-once, security, auth, tenant
isolation, sending to people, LLM prompts and evals, migrations.

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
