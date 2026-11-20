# F136 plan review 1

Job `2026-11-19-f136-plan-review-d6588bb3` (claude-opus-5-5, thinking high). Final message filed whole below.

FAIL 774e236360c626df523bf3067ad46381be97bb11

Cold review of the F136 plan: parallel Playwright suites with no shared lock (`spec/features/planned/F136-every-limen-job-runs-the-playwright-suites-in-parallel-with-no-shared-lock/`). HEAD matches the candidate. There is no code drift since plan base b3ad2e07 in the named files (`git diff --stat b3ad2e07 HEAD` over the e2e, docs, prepare, db-worktree and seed paths is empty). Plan size is within § Plan size: plan 1,486 words, and each stage is 557–694 words.

## Blocking

**B1. Stage 01 test 9 cannot pass with the D7 design (proven by reproduction).**
- Stage text: `stage-01-ports-from-env.md:39` and `:42` want the existing config case in `apps/docs/scripts/browser-check.test.ts` to set `process.env.DOCS_TEST_PORT = "28562"`, re-import the config, and expect `http://127.0.0.1:28562/email_assistant/`. Then it deletes the key and expects `…:8093/…`.
- D7 (`plan.md:19`) keeps `DOCS_TEST_PORT` and `DOCS_LOCAL_ORIGIN` as module constants in `site.ts`. The test already imports `site.ts` at the top (`browser-check.test.ts:7`). The config imports `DOCS_LOCAL_ORIGIN` from `./site` (`apps/docs/e2e/playwright.config.ts:7`).
- The cache-buster `?local=${Math.random()}` (`browser-check.test.ts:147`) re-evaluates only the config, not `site.ts`.
- Reproduction with Bun 1.4.4 in a temp folder: re-imports of `config?a=…` and then `config?b=…` after an env change both gave the first value (`A http://127.0.0.1:28562/ B http://127.0.0.1:28562/`).
- A second problem exists in a job worktree. If `site.ts` were re-evaluated, the D3 `loadRepoDotEnv` would refill the deleted key from the job `.env`, so the "deleted → 8093" half fails too.
- Missing decision, one of these, with the test that matches it:
  - the config computes the origin per evaluation (a function, not a const), or
  - the case runs the config in a child process with a clean env and no repo `.env`, or
  - the case asserts against the `DOCS_TEST_PORT` export.

**B2. Stage 03 breaks an existing test that the plan forbids the worker to edit (proven by reading; not executed).**
- `stage-03-job-env-and-drop.md:35-36` says the drop reads both marks, prints `no database …` for a missing database, and drops the sibling first.
- The existing case "drop of a database that is in use" (`apps/server/test/integration/cli-streams-other.test.ts:213-224`) calls `expectOnlyStderr`, which asserts `expect(result.stdout).toBe("")` (`:71`).
- With the new drop, a missing sibling prints `[db-worktree] no database …_e2e` on stdout before the base fails with 55006. The case fails.
- `plan.md:51` ("Edit no … existing test file except the one in D8") and D8 (`plan.md:20`) forbid the fix. `test:int:ci` is in every stage's Proof, so stage 03 cannot be both true to its text and green.
- Missing decision, one of:
  - a missing sibling prints nothing, or
  - D8 allows the change of `cli-streams-other.test.ts`, with the new expected stdout.

**B3. Coordinator record R1 (ticket Acceptance line 4) fails as written (proven).**
- `plan.md:60` runs `bun run test:e2e` "in the main checkout with no new keys".
- The main `.env` has no `E2E_` key. I checked key names only: `grep -c '^E2E_DATABASE_URL='` = 0, `grep -c E2E` = 0, `DATABASE_URL` = 1.
- So `apps/web/e2e/env.ts:61-64` throws the `missingMessage` at config load, before any port is used.
- Missing step: R1 must first make the main e2e DB and add the two `E2E_*DATABASE_URL` keys to the main `.env` (`env.ts:38`). D4 strips them again from job copies. R1 should then say "no port or tag keys" in place of "no new keys".

## Notes

**N1. D4's premise is wrong, and the real effect of D4 is untested (premise proven; effect plausible).**
- `plan.md:16` says jobs copy the main `E2E_*` keys today, so every job's `test:int` wipes one shared e2e DB. The main `.env` holds none of them (B3), so N1 (`plan.md:37`) is resolved the other way.
- What actually changes after stage 04: every job's `test:int:ci` starts to run `describe.skipIf(e2eAppUrl === "" …)("e2e seed of the plan states")` (`apps/server/test/integration/e2e-seed.test.ts:90`). Today that suite is skipped in every job and in the CI `ci` job; only the CI `e2e` job sets the keys (`.github/workflows/ci.yml:94-95`).
- Two gaps follow:
  - Stage 04 never runs `test:int:ci` in its prepared temp worktree (its tests are 1–9, `stage-04-prepare.md:22-30`).
  - No rule migrates the job e2e DB after a stage adds a migration. The seed does not migrate (`e2e-seed.ts:252-270`), so a seed that touches a new column fails in `test:int:ci`.
- Add a stage 04 test: run `test:int:ci` in worktree a. Add a rule for the migration case.

**N2. Stage 04 test 6 is not observable (proven by reading).**
- `stage-04-prepare.md:27` expects prepare to print `exists, reusing it` for both DBs.
- `db:worktree` prints that line on stdout through `out.print` (`apps/server/src/platform/cli.ts:18-20`; the stream is pinned by `cli-streams-other.test.ts:208`).
- Prepare captures that stdout into `$urls` and keeps only the URL lines (`scripts/limen-prepare.sh:36,38`). The line never reaches the prepare output.
- Decide: prepare echoes the non-URL lines of `$urls`, or test 6 checks the exit code and unchanged DB names.

**N3. Two rules conflict about the lock (proven by text).**
- `plan.md:49` says: until stage 04 lands, run `test:e2e` only under the lock.
- Stage 04 test 7 (`stage-04-prepare.md:28`) runs `test:e2e` "with no lock" before stage 04 lands.
- In practice this is safe (ports 2xxxx, own DB, tagged mail), but a worker must guess which rule wins. State the exception in one of the two places.

**N4. The D10 rule for old jobs leads to one shared DB with no lock (plausible).**
- `plan.md:22` and `stage-06-rules.md:16` tell a job prepared before stage 04 to "make its e2e DB as the `env.ts` message says".
- That message is `db:worktree e2e` (`apps/web/e2e/env.ts:37-38`). In any job worktree it makes or reuses the one database `email_assistant_e2e` (`db-worktree-args.ts:39`).
- After stage 06 removes the lock, two old jobs seed and wipe the same DB at the same time.
- The D10 CLI call also runs outside the ports flock (`stage-03:17`). That collision is loud (busy port), not silent.
- Decide: stage 01 changes the message to `db:worktree <db name>-e2e`, or the D10 text names it.

**N5. Fact F4 is false, and D6 then conflicts with the spec rule (proven by grep).**
- F4 (`plan.md:31`) says no spec holds a literal GreenMail address. `apps/web/e2e/tests/plan.spec.ts:55,64` assert `e2e-paused-box@x.test`.
- The seed creates that mailbox on GreenMail ports 3143/3025 through `insertMailbox`, not `seedAssistMailbox` (`apps/server/src/scripts/e2e-seed.ts:859-865`).
- D6 (`plan.md:18`, "Every GreenMail-backed address goes through it") would tag it and break `plan.spec.ts`, which no stage may edit (`plan.md:51`).
- `stage-02-mail-tag.md:16` scopes the tag to `seedAssistMailbox` only. Decide that the paused box stays shared and why (scout 1 left polling unknown, `scouts.md:16`), and fix F4.

**N6. No guard catches a future untagged GreenMail address (plausible).**
- F121 stage 07 edits the e2e seed while F136 runs.
- The stage 02 registry or per-function test (`stage-02:16`, test 5) covers only today's functions.
- A check inside `seedAssistMailbox` would fail any address added later: when a tag is set, the address must end in `-<tag>@`.

**N7. One job can still collide with itself (plausible).**
- Today the flock also serializes `test:e2e`, `docs:shots` and (F121) `demo:record` inside one worktree.
- All three bind `E2E_PORT` and `E2E_TELEGRAM_PORT`, seed the one job e2e DB, and share `apps/web/e2e/test-results` (`playwright.config.ts:19`, `docs-shots.config.ts:52`).
- The new `CLAUDE.md` text (`stage-06:12-17`) has no rule "one panel-suite run at a time per worktree".

**N8. The hand-made stage DBs are never dropped (proven by reading).**
- Stages 01–04 make `f136_sNN_e2e` DBs (`plan.md:50`).
- The coordinator's drop removes `<name>` and `<name>-e2e` only (`plan.md:88`, D5), so up to four `email_assistant_f136_sNN_e2e` DBs leak.
- Add their drop to the coordinator steps.

**N9. D11 can turn an odd job id into a hard prepare failure (plausible, low).**
- Prepare's sed keeps the whole lowercased id when it has no hex tail (`limen-prepare.sh:20`), and the name check passes up to 40 characters (`:21`).
- `firstSlot` throws for a tail that is not 1–16 hex characters (`stage-03:13`). With D11, such a job then fails prepare where today it starts.
- Limen ids end in 8 hex, so the risk is small. Name the case in D11 or in the CLI's exit 2.

**N10. Stage 05 may be too big for one 150-minute job (plausible, unsourced).**
- It installs and prepares 5 temp worktrees (each prepare makes and migrates two DBs), builds 5 times, and runs 9 panel runs and 6 docs runs.
- Its Proof (`stage-05-parallel-proof.md:41`) runs both scripts again after tests 3–4 (`:28-29`), so the rounds may run twice.
- No panel-suite duration is measured; F3 covers the docs suite only.
- Let the Proof grep the saved logs from tests 3–4, or record one solo panel duration first.

**N11. D9 overstates what the memory gate covers (proven against the Limen docs).**
- D9 cites "Limen's start gate (memory ≥ 20 % free)". The value is sourced in Limen `docs/jobs.md:161` (`memoryFree: 20`), but the gate acts only at job start. It does not bound a Playwright run that a running job starts later.
- The `CLAUDE.md` text (`stage-06:15`) should not imply that it does.

## Checks run
- `git rev-parse HEAD` (alone, exit 0) → `774e236360c626df523bf3067ad46381be97bb11`.
- `git diff --stat b3ad2e07 HEAD` over the named code paths → empty (no drift).
- Bun 1.4.4 module-cache reproduction in a temp folder (B1) → both re-imports kept the first env value. The folder was removed afterwards.
- `grep -c '^KEY='` on the main `.env`, counts only and no values printed: `E2E_DATABASE_URL` 0, `E2E_MIGRATOR_DATABASE_URL` 0, all `E2E` 0, `DATABASE_URL` 1, `POSTGRES_PASSWORD` 1.
- `/proc/sys/net/ipv4/ip_local_port_range` → `32768 60999`, and `ss -ltnH` shows no listener on 20000–29999. F1 holds.

## Not run (unverified)
- No suite ran: this worktree has no `node_modules` and no `.env`.
- B2 is deduced from the test source and the stage text; I did not execute it.
- I did not check whether the e2e server polls the seeded GreenMail mailboxes (affects N5).

A copy of this review: `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-19-f136-plan-review-d6588bb3/review-findings.md`.

## Note check
- HEAD is 774e236 (the candidate): proven. `git rev-parse HEAD` ran alone in one bash call, exit 0, output `774e236360c626df523bf3067ad46381be97bb11`.
- Each finding quotes file and line, and the decisions are checked against env.ts, servers.ts, site.ts and its config, limen-prepare.sh, db-worktree.ts, e2e-seed.ts and e2e-seed-args.ts: proven. Evidence: `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-19-f136-plan-review-d6588bb3/review-findings.md`. servers.ts gave no finding: D7 keeps its `--port ${E2E_TELEGRAM_PORT}` text, and `shot-run.test.ts:35` asserts it.
- The findings cover the pre-mortem (gaps, conflicting rules, steps a worker must guess, unsourced facts, stages too big for one job): proven. Evidence: `review-findings.md` (same path), B1–B3 and N1–N11.
- Easy-to-miss rule ("Missing code detail … is not a finding; a missing decision, edge case, test or interface is"): followed. Evidence: `review-findings.md`. Each item names the missing decision, test or interface, and no item asks only for line numbers, edit text or file lists.
