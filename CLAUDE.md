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
- Commit and push all work to `master` only, with a standard `git push`. Never create other branches. Never force-push (`--force`, `-f`, `--force-with-lease`).

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
