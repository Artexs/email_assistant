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
- Never force-push (`--force`, `-f`, `--force-with-lease`). Never rewrite pushed history.
- Shared runtime: one dev DB, GreenMail and the ports in `.env`. A Limen job gets its own DB from `scripts/limen-prepare.sh`. Only one checkout at a time runs `bun run test:int`. Only one at a time adds a DB migration or changes `bun.lock`.

## Work

- Work runs through Limen. Tickets: `spec/features/<lane>/FNNN-slug/`. Board and standing choices (models, prepare): `spec/build.md`. Product intent: `spec/vision.md`. Code style: `.agents/limen/styleguide.md`.
- Old tasks are in `spec/features/` too: `plan.md` in each folder is the old task file.
- Old flow, until S6 is done: `tasks/active/s6-pre-sale.md` and its sub-tasks `s6b`–`s6f` run with `run-task` and `tasks/README.md`. S6a moved to Limen: `spec/features/active/F077-s6a-customer-core/`.

## Notes

- Write `notes/YYYY-MM-DD-<topic>.md` when you learn something a later agent needs and it is not a task.
  Append to an existing note on the same topic.
- Before you investigate a topic, grep `notes/`, `spec/features/`, `tasks/` (S6 only) and `docs/known-alerts.md`.
