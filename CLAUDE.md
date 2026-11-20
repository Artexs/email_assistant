# CLAUDE.md

AI email assistant for managers: it categorizes mail, delegates tasks, filters spam and summarizes threads.
Bun workspaces: `apps/server` (Hono API, workers, scheduler), `apps/web` (Astro with React islands), `apps/docs` (Starlight site), `packages/core` (pure logic). Own Postgres; IMAP mail; Telegram; LLM roles by config.

Product (source of truth): `docs/product-brief.md`.
Architecture and stack: `docs/architecture.md`, decisions in `docs/decisions/` (ADRs). What each capability does now: `docs/capabilities/`.
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
- Shared runtime: one dev DB, GreenMail and the ports in `.env`. A Limen job gets its own DB from `scripts/limen-prepare.sh`. A stage proof is the last line of `bun run check:job` (runs the Bun of `.bun-version`, like CI and the image); the pre-commit hook checks each commit, GitHub CI runs every suite. `bun run test:int` runs in parallel in checkouts with their own DB (GreenMail tests use random addresses; 3 parallel full runs passed, 2026-11-13). A Limen job gets its own e2e DB, its own ports for both Playwright suites and its own GreenMail addresses from `scripts/limen-prepare.sh`, so `test:e2e`, `docs:test` and `docs:shots` run with no lock, in parallel with other jobs. The main checkout keeps the ports 8081, 8092 and 8093. A Playwright run takes about 2.1 GB of memory (measured with 3 parallel runs, about 6.2 GB together). No cap exists: the memory gate of Limen acts only at job start. Run one panel-suite run at a time per worktree: `test:e2e`, `docs:shots` and `demo:record` share its ports, its e2e DB and `test-results`. `demo:record` also uses the shared demo DB of the main `.env`: run it under `flock /tmp/email-assistant-shared-tests.lock`. A job prepared before this change runs `bash scripts/limen-prepare.sh` again. After a migration (own or merged), run `bun run db:migrate` and `bun run db:migrate:e2e`. Only one at a time adds a DB migration or changes `bun.lock`.
- VPS (owner, 2026-11-20): the coordinator has standing approval to build, deploy and release to the VPS (releases, env changes, VPS stages, drills) without asking the owner each time.
- CI on `master` must stay green. A test that fails twice in CI without a code change is quarantined the same day with a ticket (`docs/code-patterns.md` § Tests).

## Work

- Work runs through Limen. Tickets: `spec/features/<lane>/FNNN-slug/`. Board and standing choices (models, prepare): `spec/build.md`. Product intent: `spec/vision.md`. Code style: `.agents/limen/styleguide.md`.
- Old tasks are in `spec/features/` too: `plan.md` in each folder is the old task file.
- Owner decisions log: `docs/owner-decisions.md`. Agents took these defaults for the owner; only the coordinator writes it. A session with the owner tells them the count of `new` entries (`grep -c ' · new$' docs/owner-decisions.md`).
- Detailed implementation plans: the `plan-task` skill writes them as a Limen feature folder (`ticket.md`, `plan.md`, `stages/`); the coordinator builds them stage by stage.
- Stage 2 order: `docs/product/stage-2/05-execution-plan.md` §2 (ticket table, `## Sequenced` rule, coordinator start rule). A `plan-task` run for a Stage 2 ticket does the four steps of its §2.3.
- The old S6 files left in `tasks/` are history: `s6-pre-sale` (active), `s6b` (done), `s6f` (planned; F108).

## Notes

- Write `notes/YYYY-MM-DD-<topic>.md` when you learn something a later agent needs and it is not a task.
  Append to an existing note on the same topic.
- Before you investigate a topic, grep `notes/`, `spec/features/`, `tasks/` (S6 only) and `docs/known-alerts.md`.
