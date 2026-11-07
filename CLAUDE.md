# CLAUDE.md

AI email assistant for managers: it categorizes mail, delegates tasks, filters spam and summarizes threads.
Now: Astro starter in `src/`, old Bun backend in `backend/`. Target (from S0): Bun workspaces `apps/server`, `apps/web`, `packages/core`; own Postgres; IMAP mail; Telegram; Gemini.

Product (source of truth): `docs/product-brief.md`.
Architecture and stack: `docs/architecture.md`, decisions in `docs/decisions/` (ADRs).
Code patterns: @docs/code-patterns.md (`.ai/AGENT.md` is history: its factory pattern is no longer used).
Old specs in `.ai/` are history: read them for detail, not for decisions.

Before you diagnose an alert, grep docs/known-alerts.md.

## Rules

- Never hardcode or commit secrets, tokens or `.env`. Read them from env/config.
- Template literals for strings with variables, never `+` concatenation.
- `const` / `let` only, no `var`.
- Before each commit, review the staged changes (`git diff --staged`). Look for bugs, secrets, debug code, and changes that are not part of the task. Fix all problems, then commit.
- Git mode per task, named in the task file: `Git mode: master` (default) or `Git mode: worktree`. Steps: `tasks/README.md` § "Git mode".
  - `master`: push to `master`, create no branch. `worktree`: own worktree and branch `task/<name>`, merged into `master` with `git merge --no-ff` at the end of the task.
  - Never force-push (`--force`, `-f`, `--force-with-lease`). Never rewrite pushed history.
- Plan stages (the plan → build → review loop in `tasks/README.md` § "How to run a slice"):
  - Subagents (`planner`, `implementer`, `reviewer`) never commit or push. The main session commits and pushes.
  - One commit per stage, only after the reviewer gives PASS. The commit holds the code and the task file update (ticked steps, log line).
  - Exception, pipeline mode (`tasks/README.md` § "Pipeline mode", user decision 2026-11-07): the main session commits a stage locally when its checks pass, before the review, and pushes it only after PASS. Fixes get their own commits. Push the commits in stage order.
  - Commit message: `<area>: <slice> stage N — <what>`. Body: the steps, the check command and its result, `Reviewed: PASS` (pipeline mode: `Review: pending`; the fix commit or the push note gives the verdict).
  - A problem found after the push gets a new fix commit. Never rewrite pushed history.

## Tasks

- **Tasks** are the record of all work in the project. Each feature or bigger job gets a task file that moves from `planned/` to `active/` to `done/`. If `tasks/README.md` exists, read it before you create or move a task, because it has the template and the rules.
- When I ask for a new task or an implementation plan, create `tasks/planned/<name>.md` (or `tasks/active/` if I say to start now).
- Every plan starts with a status line: `> **Status YYYY-MM-DD — <planned | in progress | code done, deploy left | done>.**`
  plus what's left to do.
- Update the status line before each commit that changes the task.
- When it's finished, `git mv` it to `tasks/done/`. Ideas for later go to `tasks/planned/`.
- At the start of a session, read `tasks/active/`.

## Notes

- Write `notes/YYYY-MM-DD-<topic>.md` when you learn something a later agent needs and it is not a task.
  Append to an existing note on the same topic.
- Before you investigate a topic, grep `notes/`, `tasks/` and `docs/known-alerts.md`.
