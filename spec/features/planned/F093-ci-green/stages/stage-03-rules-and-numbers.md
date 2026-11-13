# F093 stage 03 — Rules and numbers

Part of [`../plan.md`](../plan.md). Not `[risky]`. Lands on the proof (no review).

Goal of the stage: the rules that keep CI green are written where every worker reads them, and the CI run times are measured. Two steps, docs only, about 60 changed lines.

Needs stages 1 and 2 landed: `test:unit:ci`, `test:int:ci`, `apps/server/test/wait-for.ts` exist.

Read first: `plan.md` D1, D3, D6, D10, D13, D14, "Done when" 6–8.

## Step 1 — The rules in three files (D1, D3, D6, D10, D13)

**Goal:** a worker, a reviewer and the coordinator find the same three rules: prove on the pinned Bun, wait for a condition, quarantine a flaky test the same day.

**Files:** `docs/code-patterns.md` (§ Tests), `.agents/limen/styleguide.md` (the check line, § Prefer, § Avoid), `CLAUDE.md` (§ Rules, the "Shared runtime" line). No other file.

**`docs/code-patterns.md` § Tests:** replace the first bullet (`` `bun run test:unit` runs unit tests; `bun run test:int` runs integration tests. ``) with the first bullet below, and append the other three after the last bullet of the section. Plain technical English, as written:

- `bun run test:unit` and `bun run test:int` run on the local Bun. `bun run test:unit:ci` and `bun run test:int:ci` run on the Bun in `.bun-version`, the version of CI and the server image (`scripts/ci-bun.sh`). A stage proof uses the `:ci` scripts. A test that passes only on the local Bun is a failing test.
- A test that waits for time-driven code waits for its condition: `waitFor(condition, what)` from `apps/server/test/wait-for.ts` (polls every 25 ms, fails after 5 s). No fixed sleep over 100 ms. A fake that holds a response releases it in its `stop()`.
- No retry in CI, no re-run as a fix, no longer test timeout as a fix for a test that hangs. A retry hides a real race.
- Quarantine: a test that fails twice in CI on `master` without a code change (the test file and the code it tests did not change between the two runs) is quarantined the same day. The coordinator creates a ticket (`limen ticket new "<test> passes on the pinned Bun" --lane planned`) and, in one commit, marks the test `test.skip(…)` with the comment `// Quarantined YYYY-MM-DD: fails in CI without a code change. Fix: spec/features/planned/FNNN-slug/`. A worker never quarantines by itself; it reports the test in its final message.

**`.agents/limen/styleguide.md`:** copy the text in each block as it is.

- Replace the line that starts `Checks before a commit:` with:

  ```markdown
  Checks before a commit: `bun run lint && bun run typecheck && bun run test:unit:ci && bun run test:int:ci`. The `:ci` scripts run the Bun of `.bun-version` (CI and the server image). Each Limen job has its own DB, so `test:int:ci` needs no lock; `test:e2e` runs under `flock /tmp/email-assistant-shared-tests.lock` (`CLAUDE.md`).
  ```

  (The old second sentence "Only one checkout at a time runs `bun run test:int`" is stale: `CLAUDE.md` allows parallel `test:int` since 2026-11-13.)

- § Prefer, after the bullet that starts `- Tests:`, add:

  ```markdown
  - A test that waits for time-driven code polls its condition with `waitFor` (`apps/server/test/wait-for.ts`); a fake releases its holds in `stop()`.
  ```

- § Avoid, add as the last bullet:

  ```markdown
  - A fixed sleep over 100 ms in a test; `test.skip`, a CI retry or a longer timeout as a fix. A test that fails twice in CI without a code change is quarantined the same day with a ticket (`docs/code-patterns.md` § Tests); only the coordinator quarantines.
  ```

**`CLAUDE.md`:** in § Rules, the "Shared runtime" bullet: after "A Limen job gets its own DB from `scripts/limen-prepare.sh`." add the sentence: "Stage proofs use `bun run test:unit:ci` and `bun run test:int:ci`: they run the Bun of `.bun-version` (CI and the image), not the local Bun." Add a new bullet after it: "CI on `master` must stay green. A test that fails twice in CI without a code change is quarantined the same day with a ticket (`docs/code-patterns.md` § Tests)."

**Decisions:** D3, D6, D10, D13. Keep the styleguide under 1000 lines (it has about 45).

**Test** (docs; checks by grep):

1. `grep -c "test:unit:ci" docs/code-patterns.md .agents/limen/styleguide.md CLAUDE.md` → each file at least 1.
2. `grep -c "Quarantine" docs/code-patterns.md` → 1; `grep -ci "quarantined" .agents/limen/styleguide.md CLAUDE.md` → each at least 1.
3. `grep -n "waitFor" docs/code-patterns.md .agents/limen/styleguide.md` → each at least one line.
4. `grep -n "Only one checkout at a time runs" .agents/limen/styleguide.md` → nothing.
5. Every path named in the new text exists: `ls .bun-version scripts/ci-bun.sh apps/server/test/wait-for.ts`.

**Check:** the five greps; `bunx prettier --check docs/code-patterns.md .agents/limen/styleguide.md CLAUDE.md` (format only these three files if it fails).

**Done when:** commit `F093 s3: rules for the pinned checks, condition waits and the quarantine`.

**Out of scope:** `spec/build.md` (coordinator prose, D14); other docs that name `bun run test:unit` (plans of other tickets, notes); `docs/product/stage-2/*`.

## Step 2 — The CI run times (D4, D14)

**Goal:** the coordinator gets the numbers for `spec/build.md` § TRACK, and the ticket records them.

**Do:**

1. `gh run list --branch master --workflow CI --limit 10 --json databaseId,headSha,conclusion,status,attempt,createdAt`. Take the latest run with `conclusion` `success` (after the stage 2 land). If none is green yet, write that in the final message with the failing test lines (`gh run view <id> --log-failed | grep -E "\(fail\)|Ran "`) and skip to "Stage done when"; the coordinator handles it (plan § How to run, item 7).
2. For that run: `gh run view <id> --json jobs --jq '.jobs[] | {name, startedAt, completedAt, steps: [.steps[] | select(.name | test("test:unit|test:int|test:e2e")) | {name, startedAt, completedAt}]}'`. Compute in seconds: the `ci` job, the `test:unit` step, the `test:int` step, the `e2e` job, the `image` job.
3. Add a line to `plan.md` § Log of this ticket (the folder is in `spec/features/active/` while it builds): `- YYYY-MM-DD: CI green on master, run <id> (<headSha 7 chars>): ci <m>m<s>s (test:unit <s> s, test:int <s> s), e2e <m>m<s>s, image <s> s.`
4. Write the TRACK line for the coordinator in the final message, in this form (fill the values):

   ```markdown
   - CI on `master`: green since YYYY-MM-DD (run <id>); ci <m>m<s>s (unit <s> s, int <s> s), e2e <m>m<s>s. Bun pin `.bun-version` 1.3.14; flaky tests: `docs/code-patterns.md` § Tests.
   ```

5. Count the green runs in a row on `master` with `attempt` 1 so far and write the count in the final message (Done when 8 needs three).

**Test:** none (measurement). Check: the Log line has five numbers and a run id.

**Done when:** commit `F093 s3: CI run times`.

**Out of scope:** editing `spec/build.md`; `limen ticket done` (coordinator, after three green runs).

## Stage done when

- Steps 1–2 are committed (or step 2 reported, as in its item 1).
- The Proof of `plan.md` § Proof, stages 2 and 3 form, with `sNN` = `s03`, prints `PROOF_OK`:

  ```
  mkdir -p /tmp/f093-s03 && bun run lint > /tmp/f093-s03/lint.log 2>&1 && bun run typecheck > /tmp/f093-s03/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f093-s03/unit-ci.log 2>&1 && bun run test:int:ci > /tmp/f093-s03/int-ci.log 2>&1 && git diff --exit-code "$(git merge-base HEAD master)" -- bun.lock deploy/Dockerfile && echo PROOF_OK
  ```

- The final message holds: the totals lines of `unit-ci.log` and `int-ci.log`, the TRACK line, and the count of green runs in a row.
