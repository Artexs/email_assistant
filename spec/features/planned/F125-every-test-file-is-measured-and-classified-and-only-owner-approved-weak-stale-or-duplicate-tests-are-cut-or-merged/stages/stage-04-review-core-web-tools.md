# F125 stage 04 — Reader review: `packages/core`, `apps/web`, `tools/fake-telegram`

Part of [`../plan.md`](../plan.md). Phase A, read-only on tests. Needs stages 01–03 landed. May run at the same time as stages 05 and 06.

Goal of the stage: one review row per flagged item of the area, by `plan.md` § Reader method, § Rules for the classes and the K rules.

## Step 1 — Core (`packages/core`, 787 cases)

- **Input:** `audit/data/cases.tsv` rows with `file` under `packages/core/`; `mutation-tests.tsv`; `mutation-survived.tsv`.
- **Extra rules for core:**
  - A case with `unique_kills > 0` is K1. It may be `MERGE-TABLE`, never `DELETE-DUP`.
  - `S11` (zero kills): check K2 first (registry, enum, schema list); a schema check of a Zod enum (`accepts owner and assistant`, `rejects other values`) is K2. Known in the probe: `web/errors.test.ts` 6 of 9 cases, `tenancy.test.ts` 3 of 3 (F3).
  - `S10` items (one per test file): compare the file's `S10` cases with its `in_cover` cases. `DELETE-DUP` only when a named `in_cover` case checks the same behaviour with the same input class. Different inputs of one rule (edge values, Polish vs English) are `MERGE-TABLE` candidates, not duplicates.
- **GAP rows:** group `mutation-survived.tsv` by source file and function (read the source around each line). A function with 5 or more survived or no-coverage mutants → one `GAP` row: file, function, count, two example mutants (line, mutator, replacement).
- **Output:** `audit/review-core-web-tools.md` § Core.

## Step 2 — Web (`apps/web/src`, `apps/web/integrations`, 157 cases) and tools (`tools/fake-telegram`, 60 cases)

- **Input:** `cases.tsv` rows of these folders.
- **Extra rules:**
  - `apps/web/src/lib/activity-text.test.ts` ties `en.ts` keys to core functions (`docs/code-patterns.md` § Web app): K2.
  - `tools/fake-telegram` is a test tool. Its tests guard the fake that the e2e and int suites use. `S8` (no production import) is expected there: not a `DELETE-STALE` reason.
- **Output:** `audit/review-core-web-tools.md` § Web and § Tools.

## Step 3 — Summary

- At the end of the file: items read and not read per section; rows per action; lines and time per action; the GAP count.
- **Done when:** the file is committed; every item of the area is in the file once (read or `not read`). Check with a count: items in the file = items selected by § Reader method step 2 (write both numbers).

## Done when

Steps 1–3 done; the Phase A Proof of `plan.md` § Proof with `NN=04` prints `PROOF_OK`.
