# F124 stage 02 — `--parallel=4` for unit and int, shared-state fixes, 5-run proof

Part of [`../plan.md`](../plan.md). Not `[risky]` by the list (no data, auth or send), but it gets a review job: a flaky `master` CI costs every later job (plan § Review).

Goal of the stage: both suites run their files in 4 workers and pass 5 times in a row. Every failure that parallel runs show is fixed in the test (D5).

## Step 1 — Measure before the change

- **Goal:** numbers to compare, and the DB connection fact (N2).
- **Files:** none in the repo. Output to `/tmp/f124-s02/`.
- **Check (save each output):**
  1. `bun test apps/server/test tools/fake-telegram/test --parallel=4 > /tmp/f124-s02/probe-int.log 2>&1` — note pass, fail and the total time.
  2. While it runs, in a second shell, every 2 s: `psql "$DATABASE_URL" -Atc "select count(*) from pg_stat_activity where datname = current_database()"`; save the peak to `/tmp/f124-s02/conn.log`. Also `psql "$DATABASE_URL" -Atc "show max_connections"`. Never print `DATABASE_URL`.
- **Done when:** the final message states the serial and parallel times, the failures, the peak connections, `max_connections`, and the result of `peak × 5 < max_connections`. If it is false: stop and report (N2); do not change the pool size.

## Step 2 — Fix the shared-state tests

- **Goal:** the parallel int run passes 5 times in a row.
- **Files:** the failing test files only, and `apps/server/test/integration/helpers.ts` if D5 needs an option there.
- **Interfaces (if needed):** `withRollback(db, fn, opts?: { isolation?: "repeatable read" })`. With the option, the transaction runs `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` as its first statement (Kysely: `db.transaction().setIsolationLevel("repeatable read").execute(…)`). Without it, nothing changes for the 89 files that use `withRollback`.
- **Decisions:** D5.
- **Known failure (F6):** `apps/server/test/integration/mail-jobs.test.ts:299` "countSyncTargets counts active mailboxes of organizations that are not suspended". It counts mailboxes across all organizations; other files commit mailboxes during it (CLI tests spawn scripts that commit). Fix: run its `withRollback` with `isolation: "repeatable read"`, so the snapshot holds only its own rows plus the rows committed before its first statement, and `pauseOtherMailboxes` covers those. If `pauseOtherMailboxes` then fails with a serialization error (`40001`) because another file updates the same rows: stop and report; do not retry.
- **Other failures:** run the parallel int suite until 5 runs in a row pass. For each new failure: find the shared state (a global count, a fixed address, a fixed row id, a mailbox read without a filter, a process-wide setting). Fix it in the test with the narrowest change: a filter by the test's own ids, a random address, or the isolation option. Write one line per fix in the final message (file, case, cause, fix).
- **Test:** the fixed cases still assert the same numbers as before (P2: no weaker assertion).
- **Check:** `bun test <fixed file>` (serial) and `bun test apps/server/test tools/fake-telegram/test --parallel=4` (all).
- **Done when:** 5 parallel runs in a row pass on your checkout.
- **Out of scope:** changes to production code; a split of `imap-contract.test.ts`.

## Step 3 — Flags in `package.json`

- **Goal:** every caller gets the parallel run.
- **Files:** `package.json` only (`scripts`).
- **Change:**
  - `test:unit`: `bun test --parallel=4 packages/core apps/server/src tools/fake-telegram/src apps/web/src/lib apps/web/src/i18n apps/web/integrations`
  - `test:int`: `bun test --parallel=4 apps/server/test tools/fake-telegram/test`
  - The `:ci` scripts stay (`bash scripts/ci-bun.sh run test:unit` inherits the flag).
- **Decisions:** D1, D2, D6. No change to `.github/workflows/ci.yml`.
- **Docs:** one line in `docs/code-patterns.md` § Tests, after the first bullet: "`test:unit` and `test:int` run their files in 4 worker processes (`--parallel=4`, each file isolated). A test must not depend on rows, addresses or settings of another file; a test that counts across organizations runs its transaction at `REPEATABLE READ` (`withRollback(db, fn, { isolation: \"repeatable read\" })`)." Adapt the last clause to the fix that Step 2 used.
- **Check:** `bun run test:unit:ci` header line shows `4x PARALLEL`; total under 12 s.
- **Done when:** both scripts carry the flag; the docs line is in.

## Done when

Steps 1–3 done; the Stage 02 Proof of `plan.md` § Proof (unit once, int 5 times) prints `PROOF_OK`. The final message lists: the times of the 5 int runs (from the log tails), the unit time, the peak connections, and every test fix.
