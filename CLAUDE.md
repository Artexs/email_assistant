# CLAUDE.md

AI email assistant for managers: it categorizes mail, delegates tasks, filters spam and summarizes threads.
Astro + React frontend in `src/`, Bun/TypeScript backend in `backend/`, Supabase.

Architecture and patterns: @.ai/AGENT.md
Product and stack: `.ai/prd.md`, `.ai/tech-stack.md`, `.ai/features.md`.

Before you diagnose an alert, grep docs/known-alerts.md.

## Rules

- Never hardcode or commit secrets, tokens or `.env`. Read them from env/config.
- Template literals for strings with variables, never `+` concatenation.
- `const` / `let` only, no `var`.
- Commit and push all work to `master` only, with a standard `git push`. Never create other branches. Never force-push (`--force`, `-f`, `--force-with-lease`).

## Tasks

- When I start a new task or ask for a task or an implementation plan, create `tasks/active/<name>.md`.
- Every plan starts with a status line: `> **Status YYYY-MM-DD — <planned | in progress | code done, deploy left | done>.**`
  plus what's left to do.
- Update the status line before each commit that changes the task.
- When it's finished, `git mv` it to `tasks/done/`. Ideas for later go to `tasks/planned/`.
- At the start of a session, read `tasks/active/`.

## Notes

- Write `notes/YYYY-MM-DD-<topic>.md` when you learn something a later agent needs and it is not a task.
  Append to an existing note on the same topic.
- Before you investigate a topic, grep `notes/`, `tasks/` and `docs/known-alerts.md`.
