# F125 stage 06 — Reader review: integration and e2e tests

Part of [`../plan.md`](../plan.md). Phase A, read-only on tests. Needs stages 01–02 landed. May run at the same time as stages 04 and 05. Spawn with `--timeout 2h`.

Goal of the stage: one review row per flagged item of `apps/server/test`, `tools/fake-telegram/test` (1,683 cases, 135 files) and `apps/web/e2e` (12 files, about 41 cases; static only), by `plan.md` § Reader method, § Rules for the classes and the K rules. The int suite holds 95 % of the suite time (F124 F6), so `MOVE-TO-UNIT` and `DELETE-DUP` against unit tests matter most here.

## Step 1 — Integration

- **Input:** `audit/data/cases.tsv` rows of `kind` `int`; `groups.tsv`; `audit/data/unit-int-pairs.tsv` if stage 05 has landed (else find the unit twins yourself and write them to `audit/data/int-unit-pairs.tsv`).
- **Extra rules:**
  - Contract suites (`apps/server/test/contract/`, `imap-contract.test.ts`, 62 cases, 43.5 s): K4. Do not propose cuts there; note in the summary that a split of the file into several files would shorten parallel runs (out of scope, F124 ticket).
  - Repository tests against Postgres (tenant filter, RLS, `FOR UPDATE SKIP LOCKED`, status-change with audit row): K3 when they check isolation or exactly-once.
  - CLI tests that spawn a script (`*-cli.test.ts`, the slowest group: `testmail-cli` 13 s, `mail-seed` 24 s, `mail-check` 16 s): for each, check whether a unit test of the same command logic exists. If yes, `MOVE-TO-UNIT` or `DELETE-DUP` for the cases that only re-check the logic; keep one case per CLI that proves the wiring (exit code and one output line).
  - `e2e-seed.test.ts:89` (`describe.skipIf` without the E2E env): `FIX-NEVER-RUNS` (F6). Evidence: the `ci` job env in `.github/workflows/ci.yml`.
- **Output:** `audit/review-int-e2e.md` § Integration.

## Step 2 — e2e (static only)

- **Input:** `cases.tsv` rows of `kind` `e2e`. Do not run `test:e2e`.
- **Rule:** an e2e case that checks only what an int or unit test checks (a route answer, a text) is `DELETE-DUP` with the kept key; a case that checks a user path through the browser is K6 (`docs/capabilities/web-panel.md`).
- **Output:** `audit/review-int-e2e.md` § e2e.

## Step 3 — Summary

- At the end of the file: items read and not read per section; rows per action; lines and time per action; the time that `MOVE-TO-UNIT` and `DELETE-DUP` would save in the int suite.
- **Done when:** the file is committed; items in the file = items selected (write both numbers).

## Done when

Steps 1–3 done; the Phase A Proof of `plan.md` § Proof with `NN=06` prints `PROOF_OK`.
