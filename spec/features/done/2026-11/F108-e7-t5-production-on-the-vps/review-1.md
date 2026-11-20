PASS 126c646b54ae4a60ea372cac19140a07721d0500

Commit reviewed: 126c646b54ae4a60ea372cac19140a07721d0500. `git rev-parse HEAD` matches it. It merges master 57d52e8e into the stage 05 branch (bb7195b1 code, 39aa68e5 docs). Master has since moved to eaa628c3. The coordinator's land step handles that.

Blocking findings: none. Every contract item in `stages/stage-05-contract.md` (tests 1–10, steps 5.1–5.3) maps to code and a test in the diff.

Unverified checks:
- `bun run check:job` was not run, by the task rule. The worker's `check:job PASS` line and GitHub CI cover it.
- The release, rollback and restore harness tests (`deploy/test/release.test.ts`, `rollback.test.ts`, `restore.test.ts`) were not run. I judged them by reading only.

The check that would prove the candidate wrong: real `docker compose config` output in which `server` or `cli` still holds a database admin key. The `cli` service gets its env from `server` (`extends: service: server`), so a stub cannot settle this. I ran that one file:
- `bun test deploy/test/compose-server-env.test.ts` gave 3 pass, 0 fail, 23 expect() calls.
- Before it, `bun install --frozen-lockfile` ran because the worktree had no `node_modules`.

How each contract item is met:
- **Test 1.** In `deploy/compose.yaml`, `server` no longer has `MIGRATOR_DATABASE_URL`, so `cli` also gets none. The new test checks that `server` and `cli` have none of the key names in `EA_D5_KEYS`, read from `compose-lib.sh`. It checks that `DATABASE_URL` uses the `app` user. It checks that `migrate` has exactly `LOG_FORMAT` and `MIGRATOR_DATABASE_URL`. Stage 01 test 7 in `apps/server/src/deploy-logging.test.ts` was removed, as the contract says ("flips").
- **Test 2.** The test searches each service's JSON text for the planted passwords. The postgres password is only under `db`. The migrator password is only under `db` and `migrate`. The app password is under `cli`, `db` and `server`, and in `server` and `cli` only inside `DATABASE_URL`.
- **Test 3.** The test loops over all services with image `ea-server` except `migrate`, without naming them. An injected `worker` service with a migrator URL is found, so the test catches a new service.
- **Tests 4–8.** The guard in `release.sh` and `rollback.sh` is the first line of `main()`, before any git call, backup or state read. It uses `ea_env_split_state`, which `release-lib.sh` loads from `compose-lib.sh`. The tests cover:
  - state `old` and state `mixed`: exit 2, no calls, no state write, no sentinel in output;
  - env check exit 1 and exit 2: `release failed at verify`, exit 1, `pending` stays set;
  - a clean env: `release ok v0.9.1 previous v0.9.0`, one env-check call;
  - rollback with state `old` or `mixed`: exit 2, state file unchanged byte for byte;
  - rollback on a split host: runs, no `check-server-env.sh` call.

  `bash deploy/check-server-env.sh` runs after `verify_release`, inside step `verify`.
- **Test 9.** The guard in `restore.sh` sits in the `new-host` branch of `set_compose`, before `ea_compose_init` and every docker call. `--down` and `--init-env` are drill only, so they never reach it. State `old` and state `mixed` give exit 2 with no docker calls. A drill with state `old` passes.
- **Test 10.** The F139 tests (`F139-1` to `F139-5`, from line 547 of `restore.test.ts`) have no diff. Only the shared fixture changed, to a split-env host, which plan-review N3 allows. Tests 4, 4b and the "no .env" refusal changed only their `--env-file` text, or now remove both env files.
- **Step 5.3.** `deploy/README.md` (§ Release and § Env split), `docs/capabilities/operations.md` items 3–4 and `docs/architecture.md` §10 describe the guard, the verify check and the server env rule.

Notes:
1. **Doc drift: the documented pre-helper rollback path is now dead (proven by code read, not run).** `deploy/README.md:118` (§ Env split) says: before a rollback to a release older than `deploy/compose-lib.sh`, run `deploy/env-split.sh --undo`, and "`deploy/rollback.sh` refuses with exit 2 and says so, until you do."
   - After `--undo`, `deploy/db.env` is gone and `.env` holds the three passwords again, so `ea_env_split_state` returns `old`.
   - The new guard at `deploy/rollback.sh:31-35` then refuses with "run deploy/env-split.sh first (state old)".
   - The operator loops between the two messages, and the script cannot reach that target.
   - The candidate deleted the matching test "11b. without db.env the same target (no helper) rolls back" in `deploy/test/rollback.test.ts`. The worker saw the conflict.
   - Contract test 8 requires exit 2 on state `old`, so the code is correct to the contract. The fault is in the plan and the docs.
   - Practical reach is low: after the contract release, `previous` is the split-capable release N or later.
   - Fix: delete or rewrite README line 118, the `--undo` sentence in `operations.md` item 4, and the message at `rollback.sh:48`. Rewritten, they should say that a rollback past release N (expand) is a manual procedure. This is a follow-up, not a block.
2. **Test-rule check (`docs/code-patterns.md` § Tests): no break found.** Each new test asserts exact values: exit codes, full message text, `toEqual([])` on the calls, the state file byte for byte. The extra-service case in compose test 3 shows that the test fails when a key is added. I did not break the code by hand to watch the harness tests fail.
3. **Plausible, low risk.** `release.sh` runs `bash deploy/check-server-env.sh` after the tag checkout, so it runs the tag's own copy of that file. Every tag from this release on carries it, so no gap now. A future tag that removes the file would fail every release at verify.

Checks run:
- `git rev-parse HEAD`: 126c646b54ae4a60ea372cac19140a07721d0500, the candidate.
- `bun install --frozen-lockfile`: 991 packages installed.
- `bun test deploy/test/compose-server-env.test.ts`: 3 pass, 0 fail.
- An earlier run of the same test file, before the install, failed with `Cannot find module '@ea/core'` because `node_modules` was missing. That was an environment problem, not a candidate problem.
- No lint, typecheck or suite ran, by the task rule.

Note check
- HEAD is the candidate sha: proven. `git rev-parse HEAD` printed 126c646b54ae4a60ea372cac19140a07721d0500.
- Diff meets contract steps 5.1–5.3: proven by read. The diff I reviewed is saved as `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-20-f108-admin-keys-out-of-server-an-69d01b38/reviewed-diff.patch`. Each item of the 10-item test list:
  - Test 1 (server and cli env, app user, migrate unchanged): proven. `deploy/test/compose-server-env.test.ts` test 1 passed in the run below.
  - Test 2 (where each sentinel appears): proven. Same file, test 2, passed.
  - Test 3 (any `ea-server` service except migrate): proven. Same file, test 3, passed.
  - Test 4 (release, state old): not proven by a run. The test exists in `deploy/test/release.test.ts` "release.sh env split"; I only read it.
  - Test 5 (release, state mixed): not proven by a run. Same reason.
  - Test 6 (env check bad, exit 1 and 2): not proven by a run. Same reason.
  - Test 7 (clean env, release ok): not proven by a run. Same reason.
  - Test 8 (rollback, old/mixed and split): not proven by a run. The test exists in `deploy/test/rollback.test.ts`; I only read it.
  - Test 9 (restore new-host guard, drill passes): not proven by a run. Test "9." in `deploy/test/restore.test.ts`; I only read it.
  - Test 10 (F139 tests unchanged): proven by read. `reviewed-diff.patch` has no hunk at or after line 547 of `deploy/test/restore.test.ts`.
- One doubt checked with a single `bun test` file: proven by its output, which showed 3 pass, 0 fail. My call chained `bun install --frozen-lockfile | tail; bun test … | tail`, so Limen will not count that command as proof. I did not run it again, because tests run once per job.
- Final message starts `PASS <sha>`: proven by this message.
- Easy-to-miss rule "Run no test suite": followed. The only test commands in this session were `bun test deploy/test/compose-server-env.test.ts`, run twice: once before the install (it failed at import), and once after.
- Reminder "Tests run once per job / no test:unit, test:int, test:e2e": followed. Only the one file ran.
- Reminder "a product-code job runs `bun run check:job` last": not applicable. This is a review job and I made no commit.
- Reminder "a review runs no suite, lint or typecheck": followed. None ran.
- Reminder "never delete `node_modules/.cache/`": followed. I did not touch it.
