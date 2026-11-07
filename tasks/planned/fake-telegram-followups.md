> **Status 2026-11-07 — planned.** Ideas from the fake Telegram build (`tasks/active/fake-telegram.md`, later `tasks/done/`). Nothing started.

# Fake Telegram: follow-ups

Scope: test tooling. Needs: the fake Telegram task merged into `master`.

## Goal

Close the small gaps that the fake Telegram build found and did not fix.

## Ideas

- **Image build in CI.** CI (`.github/workflows/ci.yml`) does not build `deploy/Dockerfile`. A missing `COPY` of a workspace `package.json` breaks `bun install --frozen-lockfile` only on the VPS. Add a CI step `docker build -f deploy/Dockerfile .` and a check that `/app/tools` holds only `fake-telegram/package.json`. The 1.1 image check of the fake Telegram task was not run: the Docker daemon refuses the agent shell user.
- **Format `docs/architecture.md`.** The file is not prettier-clean at `HEAD` (about 238 lines differ). lint-staged runs `prettier --write` on every staged `.md` file, so any small edit reformats the whole file. Format it in one commit when no parallel task edits it. Then add the `TELEGRAM_API_ROOT` line (dev only, loopback host only, used by `tools/fake-telegram`) near D8 in § 6.
- **Own DB per worktree.** The fake Telegram live run and its `test:int` run used their own databases on the dev Postgres (steps in `tools/fake-telegram/README.md` § "Live run without the shared dev DB"). A script `bun run db:worktree <name>` (create, grants, migrate, print the env overrides; `--drop`) would remove the shared-DB rule for parallel tasks. See `notes/2026-11-07-parallel-agents-worktrees.md`.
- **CLI `--chat` with negative ids.** `fake-tg` refuses `--chat -100…`. Allow it if the fake gets group chats.

## Done when

- Each idea is done or dropped, with the reason in the log.

## Log

- 2026-11-07: Created at the end of the fake Telegram build.
