# F150 stage 05 — every job runs the scan, and the rule text says so

Needs stage 04: `apps/server/src/bare-codes.test.ts` with the string, JSON and Markdown scan.
Part of [`../plan.md`](../plan.md). Review before the land (plan § Review): this changes the final check of every job.

## Step 1 — `check:job` runs the scan every time

- **Goal:** a ticket that writes a bare code in a scanned place fails its own `bun run check:job`, before the land, so master CI stays green (plan D12, review finding 1).
- **Decisions:** D12.
- **Interface:** `scripts/check-job.sh` gets one fixed step after the tests and before the `check:job PASS` line: `bun test apps/server/src/bare-codes.test.ts` (through `scripts/ci-bun.sh`, like the other test steps). It runs on the tree after the merge with master. It runs in the non-full branch. In the full branch it already runs: `test:unit` includes `apps/server/src`. The step prints one line before it (`check:job: bare-code scan`), like the other steps.
- **Edges:**
  - The step runs even when the branch changed no scanned file: a code can come from the master merge, and the run costs about 3 s.
  - A failure stops `check:job` with the hit list of the test (`path:line: text`); no PASS line.
  - The pre-commit hook does not change (plan D12, rejected option).
  - The header comment of `check-job.sh` lists the new step.
- **Test:** none automated (no test harness for the shell scripts). Tests run once per job (owner rule), so check by hand:
  1. Put `"F999"` in a non-test source string, uncommitted. Run the exact step command alone; it exits non-zero and prints that file. Revert.
  2. The one `bun run check:job` of the job prints `check:job: bare-code scan` and then the PASS line.
  The final message names both runs and their result lines.
- **Done when:** both runs behave as above; the script keeps `set -euo pipefail`, so a failed step stops it.

## Step 2 — the rule text says what the scan covers

- **Decisions:** D11 (default, owner to confirm: `questions.md` Q2).
- **Do:** the bare-code sentence of `docs/code-patterns.md` § Comments, and the "Bare codes in comments" item of `.agents/limen/styleguide.md` "Avoid", name:
  - the new reach (strings outside tests, JSON, docs site pages, `docs/modules.md`);
  - that letter codes in strings are data and pass;
  - the scan file and that `check:job` runs it.
  One sentence each. The "no mass edit" rule of § Comments stays for comments. The "Checks" paragraph of the styleguide names the scan step in one clause.
- **Out of scope:** `docs/capabilities/`, ADRs, tool READMEs, the in-place operator pages (plan P1, P3).

## Proof

`bun run check:job` (the new step included); copy its last line. The coordinator then tells the active workers once that `check:job` now runs the scan (plan § How to run).
