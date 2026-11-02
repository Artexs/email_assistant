# Tasks

All work in this repo is a task file here. One Markdown file per task: `tasks/<state>/<name>.md`.
A new session reads `active/` first. The `done/` folder is the history of the work done in the project.

## Folders

- `planned/` — next work, in rough priority order. Short files: goal, scope, done-when.
- `active/` — the work in progress now. Keep this small (normally 1–2 files).
- `done/` — finished tasks, kept for reference. Do not edit them later, except to fix links.

Move a file between folders with `git mv` when its state changes.

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
