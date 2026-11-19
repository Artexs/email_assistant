# F136 stage 04 — Prepare writes the job e2e env

Needs stage 03: CLI `apps/server/src/scripts/e2e-job-env.ts` and `db:worktree --drop` of the sibling. Needs stage 01 (`.env` loading in `env.ts` and `site.ts`) and stage 02 (`E2E_MAIL_TAG` read by the seed and `helpers.ts`): the job keys are useless without them. Edits `scripts/limen-prepare.sh`, one `package.json` script line and the missing-key message of `apps/web/e2e/env.ts`.

Part of [`../plan.md`](../plan.md). `[risky]`: every later Limen job runs this script, and a broken prepare stops every spawn. Decisions D2, D4, D10, D11. Opus review before the land.

## Step 1 — Prepare writes eight keys

**Goal.** A new job worktree can run `bun run test:e2e`, `docs:test` and `docs:shots` at once with other jobs, with no hand steps.

**Decisions.**
- The copy of the main `.env` drops these eight keys: `DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `E2E_DATABASE_URL`, `E2E_MIGRATOR_DATABASE_URL`, `E2E_PORT`, `E2E_TELEGRAM_PORT`, `DOCS_TEST_PORT` and `E2E_MAIL_TAG`.
- After the job DB exists, prepare runs `db:worktree "$name-e2e"` with the same base URLs, from the temporary `.env.base-db` that the script uses today. It appends the two printed URLs with the `E2E_` prefix and checks that each key occurs once.
- Then, under `flock /tmp/email-assistant-e2e-ports.lock`, it runs the CLI with `--job-name "$name"` and appends its four lines. So two prepares that start together get different blocks.
- Any failure exits 1 with a `limen-prepare:` message (D11).
- Output: `own DB ready (db:worktree name: $name; e2e: $name-e2e)` and `e2e ports <app>/<telegram>/<docs>, mail tag <tag>`. Never a URL or another `.env` line (the script's header rule).
- The header comment explains the eight keys and says that `db:worktree <name> --drop` now drops both DBs.
- Run again in the same worktree (for example by `limen continue`): `db:worktree` reuses both DBs. The port block may change; the old one becomes free.
- New script `db:migrate:e2e` = `dbmate -e E2E_MIGRATOR_DATABASE_URL --no-dump-schema --wait migrate` (no `bun.lock` change). D4: the integration seed suite now runs in each job, and it does not migrate. A stage that adds or merges a migration runs `db:migrate` and `db:migrate:e2e`.
- The `env.ts` missing-key message gets one more clause (D10): "in a Limen job worktree, run `bash scripts/limen-prepare.sh` again". The main-checkout command stays.

**Test (manual, saved to logs; the worker runs them from its job worktree).**
1. Two temp worktrees at HEAD (`git worktree add <tmp>/a HEAD`, `<tmp>/b`). In each, run `LIMEN_JOB_ID=2026-11-19-f136probe-0000a1a1` (and `…-0000b2b2`) `bash scripts/limen-prepare.sh` at the same time (`&` and `wait`). Both exit 0.
2. In each `.env`, each of the eight keys occurs exactly once. Check with `grep -cE '^KEY='`, one count per key. Never print the values of the URL keys.
3. `E2E_PORT` differs between a and b, and neither block overlaps the block of any other worktree.
4. `E2E_MAIL_TAG` is `0000a1a1` in a and `0000b2b2` in b.
5. `E2E_DATABASE_URL` names a database that ends in `_e2e`. Check with `seedTargetOk`, printing only ok or the reason.
6. Prepare again in a: exit 0, and the DB names that it prints are the same as in test 1 (review N2: the `reusing` line stays inside the captured output).
7. In a: `bun run web:build && bun run test:e2e` passes with no lock and no extra env (the job keys alone; the plan's lock exception).
7a. In a: `bun run test:int:ci` passes, and its log shows that the suite "e2e seed of the plan states" ran (not skipped). `bun run db:migrate:e2e` exits 0.
8. A prepare with `LIMEN_JOB_ID` unset exits 1, as today.
9. Cleanup: from the job worktree, `bun run db:worktree 2026-11-19-0000a1a1 --drop` and the same for b. Each drops two DBs. Then `git worktree remove --force` both. Save the outputs.

**Out of scope.** The lock rule texts (stage 06), the parallel rounds (stage 05), `limen` itself.

## Done when

Tests 1–9 pass, and their outputs are saved under `/tmp/f136-s04/`. Proof links after `test:int:ci`: `test -s /tmp/f136-s04/prepare-a.log && test -s /tmp/f136-s04/prepare-b.log && test -s /tmp/f136-s04/e2e-a.log && test -s /tmp/f136-s04/int-a.log && test -s /tmp/f136-s04/drop.log`. The worker writes those five logs in tests 1, 7, 7a and 9, each from a call that exited 0. The final message quotes the exit code of each.
