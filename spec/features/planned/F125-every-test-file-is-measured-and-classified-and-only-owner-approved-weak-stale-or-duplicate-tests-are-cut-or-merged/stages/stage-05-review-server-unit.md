# F125 stage 05 — Reader review: `apps/server/src` unit tests

Part of [`../plan.md`](../plan.md). Phase A, read-only on tests. Needs stages 01–02 landed. May run at the same time as stages 04 and 06. Spawn with `--timeout 2h`.

Goal of the stage: one review row per flagged item of `apps/server/src` (1,261 cases in 82 files, F1), by `plan.md` § Reader method, § Rules for the classes and the K rules. No mutation data here (D5): duplicates are judged by reading.

## Step 1 — Review

- **Input:** `audit/data/cases.tsv` rows with `file` under `apps/server/src/`; `groups.tsv`.
- **Extra rules:**
  - Completeness and table tests: `actions/completeness.test.ts`, `capability-map.test.ts`, `modules/borders.test.ts`, registry tests of notices, roles, prompts, flags, jobs: K2.
  - Log tests that check that a marker, a secret, mail text or an address does not reach a log line: K3.
  - A unit test that has an int twin (the same behaviour in `apps/server/test/integration/`): keep the unit test; note the int key in the evidence, so stage 06 can mark the int case `DELETE-DUP`. Write these pairs also to `audit/data/unit-int-pairs.tsv` (`unit_key`, `int_key`, `behaviour`).
  - A test that spies on `console` only to silence it and asserts nothing else is `S1` in effect: `REWRITE-WEAK` or `DELETE-STALE` by its name.
- **Output:** `audit/review-server-unit.md` and `audit/data/unit-int-pairs.tsv`.

## Step 2 — Summary

- At the end of the file: items read and not read; rows per action; lines and time per action.
- **Done when:** both files are committed; items in the file = items selected (write both numbers).

## Done when

Steps 1–2 done; the Phase A Proof of `plan.md` § Proof with `NN=05` prints `PROOF_OK`.
