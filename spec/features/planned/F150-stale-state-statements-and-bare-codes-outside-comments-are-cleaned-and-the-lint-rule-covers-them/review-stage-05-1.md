PASS d97c59cfabfa5f16f219336332562a0df622b94c

I reviewed commit d97c59cfabfa5f16f219336332562a0df622b94c, which is `git rev-parse HEAD` of this worktree. The tree was clean before and after the review. I found no blocking findings.

Unverified
- I saw no `bun run check:job` run of the worker for this commit. The stage asks for a `check:job: bare-code scan` line, then the PASS line. No such line is in the commit, and I did not run `check:job` (review job, no suite). Unverified, not blocking.

Acceptance checks
- The scan runs in every mode and stops the job on a hit. Proven by reading and by a run. The step `bash scripts/ci-bun.sh test apps/server/src/bare-codes.test.ts` is at `scripts/check-job.sh:56-57`. It comes after the full/non-full `if … fi`, so both modes run it, and it comes before the PASS line. `set -euo pipefail` stays. Header item 5 names the step, and `scripts/pre-commit.sh` did not change. Reproduction: I added an untracked `apps/server/src/zz-review-probe.ts` with `"see F999 here"`. Then I ran the step under `set -euo pipefail`, followed by `echo AFTER`. The result was rc=1 with 26 pass and 1 fail. The output printed the hit `apps/server/src/zz-review-probe.ts:1: "see F999 here"`, and `AFTER` did not print. I removed the probe file.
- Cost: proven. A single run of the step on the clean tree gave `Ran 27 tests across 1 file. [4.92s]`, rc=0.
- The new row fails if the test-file guard moves. Proven by a break.
  - I moved the guard ahead of the comment scan: `if (TEST_FILE.test(file)) return [];` after the Markdown branch, and `if (isTs)` in place of `if (isTs && !TEST_FILE.test(file))`. The file went red: `(fail) … > a comment in a test file`, 26 pass and 1 fail.
  - I deleted the new row and kept the same break. The file passed: 26 pass, 0 fail. So the new row is the only case that catches this regression.
  - I restored the original file, and `git status` was clean.
- The rule text is true in the scanned places. Checked by reading.
  - In `docs/code-patterns.md` § Comments, the claims are true against `bare-codes.test.ts`:
    - It scans strings outside tests for the long forms only, and letter codes in strings pass (`STRING_CODE`).
    - It scans JSON keys and values.
    - It scans the docs site pages (`apps/docs/src/content/**/*.{md,mdx}`) and `docs/modules.md`.
    - Comments in test files stay scanned.
  - The "no mass edit" clause stays.
  - In `.agents/limen/styleguide.md`, the Avoid item and the Checks clause say the same thing in one sentence each.

Notes
- The text "JSON files" is broader than the scan. This is a fact, not blocking. The scan reads JSON only under `apps/`, `packages/`, `scripts/` and `tools/`, and it skips JSON in test folders. `git ls-files '*.json'` shows unscanned JSON in `docs/` (`docs/api/openapi.json`, `docs/diagrams/module-graph.json`), `evals/`, `.vscode/` and at the root. Both rule texts say the ban covers "JSON files" / "in JSON", and code-patterns says "`bare-codes.test.ts` scans them". No unscanned JSON holds a long code today. My grep for `F\d{3}`, `PD-\d+` and `stage N` found none. A later edit could narrow the text to "JSON files under apps/, packages/, scripts/ and tools/". This is a wording note only.
- In the full branch the scan runs two times. This is a fact, not blocking. `test:unit:ci` runs it once, then step 5 runs it again, for about 5 s more. The stage text accepts this ("In the full branch it already runs"), and the extra cost is small.

Checks run
- `bun install --frozen-lockfile`: 991 packages installed.
- `bash scripts/ci-bun.sh test apps/server/src/bare-codes.test.ts`, 4 runs:
  - clean tree: 27 pass, rc=0, 4.92s
  - with the F999 probe: 1 fail, rc=1
  - with the guard moved: 1 fail, rc=1, the new row
  - with the guard moved and no new row: 26 pass, rc=0
- I ran no lint, typecheck, unit, integration or e2e suite.

Note check
- The scan runs in all modes and fails on a hit: proven. Evidence: `scripts/check-job.sh` (lines 56-57, after the `fi`) and `/tmp/f150r-run2.log` (the probe hit, 1 fail; the call exited rc=1 on purpose).
- Cost of a few seconds: proven. Evidence: `/tmp/f150r-run1.log` (last line `Ran 27 tests across 1 file. [4.92s]`).
- The rule text is true: proven for the scanned places. Evidence: `apps/server/src/bare-codes.test.ts` (roots, sourceFiles, STRING_CODE, TEST_FILE) read against the diff. "JSON files" is broader than the scan; this is filed above as a note.
- The new row fails if the guard moves: proven. Evidence: `/tmp/f150r-run3.log` (the row fails) and `/tmp/f150r-run4.log` (the same break passes without the row).
- Easy-to-miss rule "Run no suite. Name the commit reviewed.": followed. I ran only `apps/server/src/bare-codes.test.ts` through `scripts/ci-bun.sh`. The first line and the opening line of this message name d97c59cfabfa5f16f219336332562a0df622b94c.
- Reminder "tests run once per job; no test:unit/int/e2e while working": followed. I ran only single-file runs.
- Reminder "a product-code job ends with check:job": not applicable. This is a review job and I made no commit.
- Reminder "a review job runs no suite, lint or typecheck; one file only to prove a doubt": followed. My only runs were the single test file, to prove the hit behaviour and the guard-move break.
- Reminder "never delete node_modules/.cache": followed. I did not touch it.
