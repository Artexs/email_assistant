# Parallel agents: worktree + branch + PR per task

Date: 2026-11-07. Status: proposal. The user has not decided yet. No code or rules changed.

## Question

One pi agent works on `master` and pushes direct. The user wants more agents at the same time.
Two agents in one folder change the same files. The user proposes: each agent gets its own git worktree and branch,
commits there, opens a PR, an agent reviews and merges it.

## Verdict

The idea is correct. It is the standard pattern for parallel coding agents.
The MEGA lesson S01E04 ("Multi-agent setup") describes the same design in Limen:
"git worktrees give each Worker its own copy of the code and its own branch, so Workers don't interfere with each other",
and the Coordinator merges the branch (`~/Documents/repos/mega/lessons/s01/s01e04-lesson.md`, lines 120–141).
S02E04 adds: split work between agents to control "concurrency, conflicts and structure", and block some actions until a human approves.

Change one part of the proposal: **small, short-lived branches, not "few big PRs"**.
Conflict size grows with branch age and branch size. Merge often.

## What a worktree does NOT isolate (main trap in this repo)

A worktree isolates files only. Runtime resources stay shared:

| Resource         | Now (`.env.example`)                  | Problem with 2+ agents                                   |
| ---------------- | ------------------------------------- | -------------------------------------------------------- |
| Postgres         | `127.0.0.1:5433/email_assistant`      | Tests and migrations of agent A change the DB of agent B |
| Server port      | `PORT=8080`                           | Second dev server fails to start                         |
| Test mail server | `TEST_IMAP_PORT=3143`, `3993`, `3025` | Port clash, shared mailboxes                             |
| `.env`           | gitignored                            | Not present in a new worktree                            |
| `node_modules`   | per folder                            | Each worktree needs `bun install`                        |

Fix: one setup script per worktree. It copies `.env`, sets a port offset (example: slot N → `PORT=8080+N`),
uses its own DB name (`email_assistant_<slot>`) or schema, and runs `bun install`.
Alternative: one container (devcontainer / docker compose project) per agent. Stronger isolation, more setup.

2026-11-07: the DB part of the fix exists now as `bun run db:worktree <name>` (`--drop` removes the database). Port offset, `.env` copy and GreenMail stay open.

## Conflict hot spots in this repo

- `tasks/README.md`, `docs/roadmap.md`: only the coordinator edits them, on `master`.
- Task files: each agent edits only its own `tasks/active/<name>.md`. Separate files do not conflict.
- DB migrations: numbered files clash. Give the number at merge time, or let only one task touch migrations at a time.
- `bun.lock` / `package.json`: let one agent add dependencies at a time, or regenerate the lock after rebase.
- Shared core types (`packages/core`): do not run two tasks on the same module at the same time.

Best defence: the coordinator picks tasks that touch different areas. Isolation reduces conflicts; good task split prevents them.

## Proposed flow

1. **Coordinator** (one pi session with you) picks 2–3 independent tasks from `tasks/planned/`.
2. For each task: `git worktree add ../email_assistant-wt/<task> -b task/<task> origin/master`, then run the setup script.
3. **Worker** (one pi per worktree, own herdr/tmux tab) runs the existing plan → build → review loop. One commit per stage on its branch, push the branch.
4. When the task is done: worker runs `git rebase origin/master`, fixes conflicts itself (it knows the intent), runs checks, opens a PR with `gh pr create`.
5. **Gate:** CI (`.github/workflows/ci.yml`) must pass + reviewer agent gives PASS on the PR diff.
   For `[risky]` areas (list in `tasks/README.md`): you approve the PR.
6. **Merge:** only one agent merges (the coordinator), one PR at a time, squash or merge commit.
   After each merge, the other open branches rebase on the new `master`.
   GitHub branch protection "require branches to be up to date" + auto-merge enforces this.
7. Cleanup: `git worktree remove`, delete the branch, drop the worker DB. Limen does this with `limen prune`.

PR size: one PR per task (1–5 stages, about 300 lines per stage). If a task has more than about 5 stages, open a PR per checkpoint.

## Options, from light to heavy

| Option                      | What                                                                                      | Good                               | Bad                                      |
| --------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------- |
| A. Plain worktrees + script | `git worktree` + setup script + pi per tab                                                | Fast, no new tools                 | You coordinate by hand                   |
| B. Limen (pi + herdr)       | Coordinator/Worker/Supervisor, worktree per job, job records, end notifications, steering | Fits the pi setup, from the course | New tool to learn; some parts macOS only |
| C. Container per agent      | devcontainer / compose project per worktree                                               | Full isolation of DB and ports     | More setup and RAM                       |
| D. Remote agents            | VPS with Limen, Claude Code GitHub Actions, Codex / Cursor cloud agents; each opens a PR  | Runs without your laptop           | Cost, secrets on remote, slower feedback |

Recommendation: start with A (or B if you already like herdr) plus the per-worktree DB/port setup. Run max 2–3 workers first.
Move to D later, when the flow is stable (S01E05 "Getting remote").

## Rules that must change if adopted

- `CLAUDE.md` § Rules: "Commit and push all work to `master` only ... Never create other branches" → workers commit to `task/<name>`; only the coordinator merges to `master`. Keep "never force-push" for `master`; allow `--force-with-lease` on own task branches after rebase, or forbid rebase and use merge commits.
- `tasks/README.md` § "How to run a slice": add worktree, PR, merge steps.
- `~/.pi/agent/skills/run-task/`: commit and push to the task branch, open a PR at the end.
- `~/.pi/agent/extensions/config-autocommit.ts`: check that it does not commit in the wrong worktree.
