# F125 stage 06 — Reader review: integration and e2e tests

Part of [`../plan.md`](../plan.md). Phase A, read-only on tests. Needs stage 01: `audit/data/groups.tsv`; stage 02: `audit/data/cases.tsv`. Reads stage 05 `audit/data/unit-int-pairs.tsv` only if the file exists in `master` at the start of the job (not a dependency). May run next to 03, 04 and 05. Spawn with `--timeout 2h`. At most 150 items per job, committed every 50 (`plan.md` § Reader method). Estimate at 1927d052: about 210 items + int `S9` (unknown before stage 02); one or two continuations. Items left after two continuations are the fastest `S9` cases and stay `not read` (`questions.md` Q5).

Goal of the stage: one review row per flagged item of `apps/server/test` (430 files, 5,514 call sites at 1927d052), `tools/fake-telegram/test` (4 files, 19 call sites) — JUnit counts come from stage 02 — and the Playwright files `apps/web/e2e` (38 spec files, 224 `test(` calls) and `apps/docs/e2e/site.spec.ts` (8), static only, by `plan.md` § Reader method, § Rules for the classes and the K rules. The int suite holds 95 % of the suite time (F124 F6), so `MOVE-TO-UNIT` and `DELETE-DUP` against unit tests matter most here.

## Step 1 — Integration

- **Input:** `audit/data/cases.tsv` rows of `kind` `int`; `groups.tsv`; `audit/data/unit-int-pairs.tsv` if it exists in `master` at the job start (else find the unit twins yourself and write them to `audit/data/int-unit-pairs.tsv`).
- **Extra rules:**
  - The contract suites (`apps/server/test/contract/mail-provider.ts` and `mail-sender.ts`, run by `imap-contract.test.ts`, `smtp-send.test.ts`, `graph-send.test.ts`; `imap-contract.test.ts` was 62 cases and 43.5 s at 54fe78f, stage 02 gives the time at the stage base): K4. Do not propose cuts there; note in the summary that a split of the file into several files would shorten parallel runs (out of scope, F124 ticket).
  - Repository tests against Postgres (tenant filter, RLS, `FOR UPDATE SKIP LOCKED`, status-change with audit row): K3 when they check isolation or exactly-once.
  - CLI tests: test files that spawn a script process (`Bun.spawn`, `spawn`, `$\`bun …\``), whatever their name (45 int files at 1927d052); the slowest at 54fe78f: `mail-seed.test.ts` 24 s, `mail-check.test.ts` 16 s, `testmail-cli.test.ts` 13 s: for each, check whether a unit test of the same command logic exists. If yes, `MOVE-TO-UNIT` or `DELETE-DUP` for the cases that only re-check the logic; keep one case per CLI that proves the wiring (exit code and one output line).
  - `e2e-seed.test.ts:90` (`describe.skipIf` without the E2E env): `FIX-NEVER-RUNS` (F6). Evidence: the `ci` and `e2e` jobs in `.github/workflows/ci.yml` and the E2E keys of `scripts/limen-prepare.sh`, both read at the stage base.
- **Output:** `audit/review-int-e2e.md` § Integration.

## Step 2 — e2e (static only)

- **Input:** `cases.tsv` rows of `kind` `e2e`. Do not run `test:e2e`.
- **Overlap with the parallel-Playwright ticket (F136):** it may change `apps/web/e2e/env.ts` and `playwright.config.ts`, `apps/docs/e2e/site.ts` and its Playwright config, the e2e seed scripts and their test `apps/server/test/integration/e2e-seed.test.ts`, and `scripts/limen-prepare.sh` (ports and per-job E2E DB). This stage only reads; read the files at the stage base and write that base in the review file. Keys that F136 moves are re-resolved by Cut stage rule 2; open F136 branches block cuts by Cut stage rule 3.
- **Rule:** an e2e case that checks only what an int or unit test checks (a route answer, a text) is `DELETE-DUP` with the kept key; a case that checks a user path through the browser is K6 (`docs/capabilities/web-panel.md`).
- **Output:** `audit/review-int-e2e.md` § e2e.

## Step 3 — Summary

- At the end of the file: items read and not read per section; rows per action; lines and time per action; the time that `MOVE-TO-UNIT` and `DELETE-DUP` would save in the int suite.
- **Done when:** the file is committed; items in the file = items selected (write both numbers).

## Done when

Steps 1–3 done; the Phase A Proof of `plan.md` § Proof with `NN=06` prints `PROOF_OK`.
