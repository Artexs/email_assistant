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
- On the owner's Omarchy machine, a local git hook pushes `master` after each commit or merge (`.git/hooks/post-commit`, `post-merge` → same file; log `.git/auto-push.log`). A `PUSH FAILED` line there needs `git pull --rebase && git push`. After the land of a branch that holds a history merge (F091 stages 01–02, `docs/code-patterns.md` § Size and shape), use `git pull --no-rebase && git push` instead: a rebase replays the copy commits and conflicts.
- Shared runtime: one dev DB, GreenMail and the ports in `.env`. A Limen job gets its own DB from `scripts/limen-prepare.sh`. Stage proofs use `bun run test:unit:ci` and `bun run test:int:ci`: they run the Bun of `.bun-version` (CI and the image), not the local Bun. `bun run test:int` runs in parallel in checkouts with their own DB (GreenMail tests use random addresses; 3 parallel full runs passed, 2026-11-13). `bun run test:e2e` uses the fixed ports 8081 and 8092: run it only under `flock /tmp/email-assistant-shared-tests.lock`. Only one at a time adds a DB migration or changes `bun.lock`.
- CI on `master` must stay green. A test that fails twice in CI without a code change is quarantined the same day with a ticket (`docs/code-patterns.md` § Tests).

## Work

- Work runs through Limen. Tickets: `spec/features/<lane>/FNNN-slug/`. Board and standing choices (models, prepare): `spec/build.md`. Product intent: `spec/vision.md`. Code style: `.agents/limen/styleguide.md`.
- Old tasks are in `spec/features/` too: `plan.md` in each folder is the old task file.
- Detailed implementation plans: the `plan-task` skill writes them as a Limen feature folder (`ticket.md`, `plan.md`, `stages/`); the coordinator builds them stage by stage.
- Stage 2 order: `docs/product/stage-2/05-execution-plan.md` §2 (ticket table, `## Sequenced` rule, coordinator start rule). A `plan-task` run for a Stage 2 ticket does the four steps of its §2.3.
- Not moved yet: `tasks/active/s6-pre-sale.md` (S6 master plan) and `tasks/planned/s6b`–`s6f`. The old `run-task` flow is removed (2026-11-12): plan each segment with `plan-task` into `spec/features/`. S6a is Limen ticket F077.

## Notes

- Write `notes/YYYY-MM-DD-<topic>.md` when you learn something a later agent needs and it is not a task.
  Append to an existing note on the same topic.
- Before you investigate a topic, grep `notes/`, `spec/features/`, `tasks/` (S6 only) and `docs/known-alerts.md`.
