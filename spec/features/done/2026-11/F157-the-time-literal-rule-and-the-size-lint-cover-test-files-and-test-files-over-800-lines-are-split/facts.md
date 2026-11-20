# F157 facts

Part of [`plan.md`](plan.md). Facts that the decisions rest on.

## Checked (2026-11-20, at ea317d34)

- F1. 39 `*.test.{ts,tsx}` files are over 800 lines (`git ls-files '*.test.ts' '*.test.tsx' | xargs wc -l`), the same 39 that the F125 report names. Other test code over 800: `apps/server/test/integration/fixtures.ts` (805). 1,078 test files.
- F2. The rule finds 743 time literals in 288 test-code files (probe: `procedures.md` § Probe). Per stage: 01 108 in 52 files, 02 259 in 101, 03 168 in 63, 04 208 in 72.
- F3. Bun 1.4.4 JUnit: `classname` holds the `describe` path, inner first (`inner > outer`); `test.each` gives one `<testcase>` per row; a skipped case has `<skipped />` (probe in a temp folder). `parseJunit` in `scripts/test-audit/junit.ts` reads these fields.
- F4. `eslint` exits 0 on warnings; no script passes `--max-warnings` (`scripts/lint.sh`, `ci.yml`).
- F5. `time-lint.test.ts` and `file-size.test.ts` assert that test code is out; stages 04 and 20 flip them.

## Not verified

- History merge on a test file: F091 ran it on repo files only. Stage 06 is the first; its log records `git log --follow` of one part.
- F6 (2026-11-20, repair after plan review 1, at f4c2a1bc). Tests that read cited paths: `apps/server/src/capability-map.test.ts` (backticked paths in `docs/capabilities/`), `apps/server/src/legal-papers.test.ts` (paths in `docs/legal/`), `apps/docs/src/security/claims.test.ts` (runs `claimProblems` on the real public claims; the docs build runs the same check). `FIXTURE_LABELS` in `bare-codes.test.ts` is a `Record` read by exact path. `history-copies.sh` adds each copy with `git update-index --add --cacheinfo`, with no existence check.
