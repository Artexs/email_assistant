# F136 stage 05 — Parallel proof, three rounds

Needs stage 04: `scripts/limen-prepare.sh` writes the eight job keys. This stage's own job must be spawned after stage 04 lands, with `--timeout 150m`. Needs stages 01–02 through prepare (ports and the mail tag are read).

Part of [`../plan.md`](../plan.md). Decisions D2, D6, D9; not-verified items N2 and N3. Proves ticket Acceptance lines 1–3.

## Step 1 — A reusable parallel check

**Goal.** One command shows that N job worktrees run a Playwright suite at the same time and all pass. Agents run it again after a Playwright or Chromium upgrade.

**Files.** New `scripts/e2e-parallel-check.sh`. A short header comment holds the usage and says that it creates and drops DBs on the dev Postgres.

**Interface.** `bash scripts/e2e-parallel-check.sh --e2e-runs N --docs-runs M --rounds R --out DIR`, with N and M 0–4 (not both 0) and R 1–5. It makes `max(N, M)` worktrees once (review N10: fewer prepares and builds), runs the R e2e rounds first, then the R docs rounds in M of the same worktrees.
- It refuses the main checkout (the same check as prepare) and needs `LIMEN_CONTEXT_ROOT` or the first `git worktree list` entry.
- It makes N temp worktrees at `HEAD` under `$(mktemp -d)`. It prepares each with `LIMEN_JOB_ID=<today>-parallel-<8 random hex>` and `bash scripts/limen-prepare.sh`, then builds once per worktree (`web:build` when N > 0, `docs:build` when M > 0).
- Per round, it starts the suite in all N worktrees at once, with no lock. It records the start and end time and the exit code of each run, and samples the peak RSS of each run's process tree every 0.5 s (the sum over the tree, as in the planning probe). Logs go to `DIR/round-<r>-run-<n>.log`.
- It prints one summary line per run (`round r run n exit c start end peak_mb`) and a final `PARALLEL_OK` only when every run exited 0 and every round's runs overlap in time.
- A trap removes the worktrees and drops the DBs on any exit. It drops them with `bun run db:worktree <name> --drop` from the calling worktree, where the probe DB is not a base DB. The script lists any drop that failed.
- No `.env` line or URL appears in its output.

**Test.**
1. `--e2e-runs 0 --docs-runs 0`, `--e2e-runs 5`, `--rounds 0` and an unknown flag each exit 2 with the usage.
2. A small run, `--e2e-runs 0 --docs-runs 1 --rounds 1`, passes and leaves no worktree and no `email_assistant_*parallel*` DB behind (check with `git worktree list` and a `psql -lqt` name grep, names only).

## Step 2 — The acceptance rounds

**Runs (saved under `/tmp/f136-s05/`).**
3. `--e2e-runs 3 --docs-runs 2 --rounds 3 --out /tmp/f136-s05/rounds > /tmp/f136-s05/rounds.log 2>&1` prints `PARALLEL_OK`. The e2e rounds and the docs rounds do not overlap each other (D9: memory).

**Record.** A new file in this ticket folder, `proof-parallel.md`, holds the two summaries (the per-run lines), the peak memory per run of each suite (max and median), the free memory before the first round (`free -m`), and the HEAD commit. Stage 06 copies the memory figure into `CLAUDE.md`.

**When a round fails.** Read the run log. A flaky spec that also fails alone, with no other run, is not this ticket's: name it and run the round again once. A failure that comes from sharing (a port, a DB, a GreenMail account, a file in the repo, a fixed temp path) is a gap: stop and write it in the final message with the log lines. Do not widen the scope.

**Out of scope.** Rule texts (stage 06). Any spec change.

## Done when

Tests 1–3 pass and `proof-parallel.md` is committed. Proof links after `test:int:ci` (the rounds run once, in test 3; the Proof only reads the saved log): `grep -q PARALLEL_OK /tmp/f136-s05/rounds.log`.
