# F125 stage 04 — Reader review: `packages/core`, `apps/web`, `apps/docs`, `deploy/test`, `tools`

Part of [`../plan.md`](../plan.md). Phase A, read-only on tests. Needs stage 01: `audit/data/groups.tsv`; stage 02: `audit/data/cases.tsv`; stage 03: `audit/data/mutation-tests.tsv`, `mutation-survived.tsv`. May run next to 05 and 06. Spawn with `--timeout 2h`. At most 150 items per job for the whole stage (all sections), committed every 50 (`plan.md` § Reader method). Estimate at 1927d052: about 380 items (`plan.md` N4), so expect one or two continuation jobs (How to run step 4).

Goal of the stage: one review row per flagged item of the area, by `plan.md` § Reader method, § Rules for the classes and the K rules.

## Step 1 — Core (`packages/core`, 2,760 JUnit cases in 165 files at 1927d052)

- **Input:** `audit/data/cases.tsv` rows with `file` under `packages/core/`; `mutation-tests.tsv`; `mutation-survived.tsv`.
- **Extra rules for core:**
  - A case with `unique_kills > 0` is K1. It may be `MERGE-TABLE`, never `DELETE-DUP`.
  - `S11` (zero kills): check K2 first (registry, enum, schema list); a schema check of a Zod enum (`accepts owner and assistant`, `rejects other values`) is K2. Known in the 54fe78f probe: `web/errors.test.ts` 6 of 9 cases, `tenancy.test.ts` 3 of 3 (F3).
  - `S10` items (one per test file): compare the file's `S10` cases with its `in_cover` cases. `DELETE-DUP` only when a named `in_cover` case checks the same behaviour with the same input class. Different inputs of one rule (edge values, Polish vs English) are `MERGE-TABLE` candidates, not duplicates.
- **GAP rows:** group `mutation-survived.tsv` by source file and function (read the source around each line). A function with 5 or more survived or no-coverage mutants → one `GAP` row: file, function, count, two example mutants (line, mutator, replacement).
- **Output:** `audit/review-core-web-tools.md` § Core.

## Step 2 — Web, docs, deploy and tools

Unit JUnit counts at 1927d052 (F1): web `apps/web/src/lib` 920, `apps/web/src/i18n` 54, `apps/web/integrations` 19; docs site `apps/docs/src` 139, `apps/docs/integrations` 64, `apps/docs/scripts` 119; `deploy/test` 89; `tools/fake-telegram/src` 59; `tools/mail-oauth-spike` 2 files in no suite.

- **Input:** `cases.tsv` rows of these folders.
- **Extra rules:**
  - `apps/web/src/lib/activity-text.test.ts`, describe "words tied to the Telegram source": web texts equal the core texts per locale (`docs/code-patterns.md` § Web app): K2. The other describes of that file are judged like any case.
  - `apps/web/src/i18n`: key-parity tests (each English group has the same keys as its Polish group, placeholders match) are K2.
  - `apps/docs/src` and `apps/docs/integrations`: content and link checks (every page exists, a placeholder in both languages, the in-place check after the build) are K2; a CSP or header check is K3. `apps/docs/e2e/` belongs to stage 06, not here.
  - `deploy/test` and `apps/docs/scripts` test shell scripts, workflow and config files by reading or running them: `S8` is expected there, not a `DELETE-STALE` reason. Their checks of deploy and secret rules (no `.env`, no secret, no migrate in rollback) are K3.
  - `tools/mail-oauth-spike/*.test.ts` runs in no suite (`not-run`): `FIX-NEVER-RUNS` (add to a suite) or `DELETE-STALE` when the spike code is gone or unused; name the evidence.
  - `tools/fake-telegram` is a test tool. Its tests guard the fake that the e2e and int suites use. `S8` (no production import) is expected there: not a `DELETE-STALE` reason.
- **Output:** `audit/review-core-web-tools.md` § Web, § Docs, § Deploy and § Tools.

## Step 3 — Summary

- At the end of the file: items read and not read per section; rows per action; lines and time per action; the GAP count.
- **Done when:** the file is committed; every item of the area is in the file once (read or `not read`). Check with a count: items in the file = items selected by § Reader method step 2 (write both numbers).

## Done when

Steps 1–3 done; the Phase A Proof of `plan.md` § Proof with `NN=04` prints `PROOF_OK`.
