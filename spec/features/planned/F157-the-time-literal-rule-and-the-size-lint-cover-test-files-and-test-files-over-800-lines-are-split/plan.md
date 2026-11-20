# F157 plan — time and size rules reach test code; test files over 800 lines are split

> **Status 2026-11-20 — planned.** Plan base: ea317d34. No stage built.

## Input

Owner words (F125 `audit/report.md` § Questions, question 3, answered 2026-11-20): "yes, as one planned follow-up ticket at low priority: extend the time-literal rule to test files, split the test files over 800 lines, then extend the size lint to tests."

### Decisions

- **D1 Test code.** "Test code" is the list that both rules skip today (`sizeIgnores` in `eslint.config.js`): `**/*.test.{ts,tsx}`, `**/*.spec.ts`, `**/*.test-helper.ts`, `apps/server/test/**`, `apps/*/e2e/**`, `tools/*/test/**`, wherever such a file lives (also `apps/docs/scripts/`, `scripts/`). After F157 both rules cover all of it (default, owner to confirm: `questions.md` 1). Rejected: `*.test.ts` only (helpers then grow without a limit; `fixtures.ts` is 805 lines).
- **D2 Time rule scope.** The `ea/no-time-literals` block adds the D1 globs to its `files`. Its ignores keep `packages/core/src/time.ts` and add `packages/core/src/time.test.ts` (it pins the three values). Rejected: a disable comment in `time.test.ts` (the pair is one definition).
- **D3 Time fix.** A hit becomes `MINUTE_MS`, `HOUR_MS` or `DAY_MS` from `@ea/core` with the same value, folded to the largest whole unit (`docs/code-patterns.md` § Size and shape). A local copy (`const MINUTE = 60_000`) goes; its uses take the core name. A number that is not a time gets `// eslint-disable-next-line ea/no-time-literals -- <reason>`. No expected value, timeout value or case changes.
- **D4 Time rule in parts.** Stage 01 fixes the test code outside `apps/server/test/` and `tools/*/test/` and turns the rule on there. Stages 02 and 03 fix int files by name range with no config change. Stage 04 fixes the rest, turns the rule on for all test code, and fixes any hit that other tickets added since. Rejected: one stage (743 hits).
- **D5 Split method.** The F091 history merge (`spec/features/done/2026-11/F091-repo-split/tools.md`, `history-copies.sh`), then the trim commit at once; `git log --follow` reaches the old file from each part. Never rebase or squash; merge `master`. If `master` changes a file of the stage after the history merge, reset to the new `master` and split again (F143 D6). Steps: `procedures.md` § Split.
- **D6 Parts.** Topics follow the top-level `describe` blocks. Each part is at most 600 lines (headroom under 800; under 400 where a topic allows). Name: `<old base>-<topic>.test.ts` in the old folder; no part keeps the old name. Default, owner to confirm: `questions.md` 2.
- **D7 Same cases.** Every case keeps its `describe` path and name. A `describe` split over two parts keeps its name in both. Tests that share state (one case reads what an earlier case wrote) stay in one part. Setup hooks repeat in each part (or a helper that registers them).
- **D8 Shared code.** A helper used by two or more parts moves once to a helpers file: `apps/server/test/integration/<old base>-helpers.ts` for int files (an existing `-helpers.ts` takes it while it stays under 600 lines), `<old base>.test-helper.ts` next to a file under `src/`. A helper used by one part stays in that part. No helper body is copied.
- **D9 Split proof.** Stage 05 adds `scripts/test-audit/split-proof.ts`. It compares the JUnit XML of the old file (run at the stage base) with the XML of the parts. Key: `classname`, `name` and `skipped` of each `<testcase>`, as a multiset; the file path is not in the key. Exit 0 and `split-proof PASS cases=<n>` when both multisets are equal; exit 1 and each missing or extra key otherwise. A case whose `assertions` count differs is printed as `assertions <key> <before> <after>` and does not fail (polls change it); the worker explains each in the stage log.
- **D10 Stage log.** Each split stage writes `split-log/stage-NN.md` in this folder: per old file its line count, its parts with line counts, the `split-proof` line, and the assertion lines with a reason.
- **D11 Moving targets.** A listed file at or under 800 lines at the stage `HEAD` is not split; the log says so. Stage 20 measures again: a test-code file over 800 lines that no stage split is split in stage 20 when there are at most 2; with more, stage 20 stops and asks for one more split stage.
- **D12 Size rule.** Stage 20 deletes `sizeIgnores`, so the 400 warning and the 800 error reach test code. The scan "no source file disables a size rule" (`apps/server/src/file-size.test.ts`) covers test code too. About 173 test files of 401–800 lines then warn; that is accepted (default, owner to confirm: `questions.md` 3).
- **D13 Docs.** Stage 04 and stage 20 change `docs/code-patterns.md` § Size and shape and the comments in `eslint.config.js` that say test code is out. No capability page names these rules.

## Facts checked (2026-11-20, at ea317d34)

- F1. 39 `*.test.{ts,tsx}` files are over 800 lines (`git ls-files '*.test.ts' '*.test.tsx' | xargs wc -l`), the same 39 that the F125 report names. Other test code over 800: `apps/server/test/integration/fixtures.ts` (805). 1,078 test files.
- F2. The rule finds 743 time literals in 288 test-code files (probe: `procedures.md` § Probe). Per stage: 01 108 in 52 files, 02 259 in 101, 03 168 in 63, 04 208 in 72.
- F3. Bun 1.4.4 JUnit: `classname` holds the `describe` path, inner first (`inner > outer`); `test.each` gives one `<testcase>` per row; a skipped case has `<skipped />` (probe in a temp folder). `parseJunit` in `scripts/test-audit/junit.ts` reads these fields.
- F4. `eslint` exits 0 on warnings; no script passes `--max-warnings` (`scripts/lint.sh`, `ci.yml`).
- F5. `time-lint.test.ts` and `file-size.test.ts` assert that test code is out; stages 04 and 20 flip them.

## Not verified

- History merge on a test file: F091 ran it on repo files only. Stage 06 is the first; its log records `git log --follow` of one part.

## Done when

1. `bun run lint` fails on `const a = 60_000;` in `apps/server/test/integration/x.test.ts` (case in `time-lint.test.ts`).
2. `bun run lint` fails on an 801-line `apps/server/src/x.test.ts` and `apps/server/test/integration/x.ts` (cases in `file-size.test.ts`).
3. `git ls-files` of test code `| xargs wc -l` shows no file over 800 lines.
4. Every `split-log/stage-NN.md` has a `split-proof PASS` line per split file.

## Rules for every stage

- Out of scope: any change of what a test checks (expected values, cases, timeouts). A move or a spelling change only.
- A gap or a deviation is a question in the final message, not a choice.
- Format only the stage's files.
- Run single test files with `bun test <file>`; int files with the env of `check:job` (`EA_TEST_WORKER_DB=1`). Never `test:unit` or `test:int`.

## Proof

Last step of each stage: `bun run check:job`; copy its last line (`check:job PASS master=… tip=…`). Stages 04 and 20 also run `bun run lint` once over the whole repo and save the log.

## Review

No stage is `[risky]`. Split stages land on their `split-proof` lines. Stages 04 and 20 change lint config: a `claude-sonnet-5-5` review before the land. No owner checkpoint.

## Stages

Needs lines are in each stage file. Split stages of different files may run next to each other.

- [x] [01 — time rule: non-int test code](stages/stage-01-time-rule-outside-int.md)
- [x] [02 — time fixes: int files a–l](stages/stage-02-time-int-a-l.md)
- [x] [03 — time fixes: int files m–r](stages/stage-03-time-int-m-r.md)
- [x] [04 — time fixes s–z; rule on for all test code](stages/stage-04-time-int-s-z-and-rule.md)
- [x] [05 — split proof tool](stages/stage-05-split-proof.md)
- [x] [06 — split: core digest, digits, notice registry](stages/stage-06-split-core.md)
- [x] [07 — split: server config and eval](stages/stage-07-split-server-unit.md)
- [x] [08 — split: actions repo and send](stages/stage-08-split-actions-repo-send.md)
- [x] [09 — split: actions committer, follow-up, move, drafts](stages/stage-09-split-actions-rest.md)
- [x] [10 — split: channels notices and commands](stages/stage-10-split-channels-notices.md)
- [x] [11 — split: channels callbacks, card sync, sender](stages/stage-11-split-channels-rest.md)
- [x] [12 — split: reply review, follow-up cards, fixtures, lab seed](stages/stage-12-split-a-l-rest.md)
- [x] [13 — split: mail sync and history backfill](stages/stage-13-split-mail-sync.md)
- [x] [14 — split: mail jobs and OAuth](stages/stage-14-split-mail-jobs-oauth.md)
- [x] [15 — split: mail repo, drafter job, reply sweep](stages/stage-15-split-mail-repo-replies.md)
- [x] [16 — split: privacy erase, retention, reply lifetime](stages/stage-16-split-privacy-retention.md)
- [x] [17 — split: triage service, triage job, SLO checks](stages/stage-17-split-triage.md)
- [x] [18 — split: trust history and regate](stages/stage-18-split-trust.md)
- [x] [19 — split: web two-factor and HTTP](stages/stage-19-split-web.md)
- [x] [20 — size rule on for test code](stages/stage-20-size-rule.md)

## How to run (coordinator)

Spawn per stage with the board's worker flags (`spec/build.md` TRACK) and `--prepare 'bash scripts/limen-prepare.sh'`. Task: "Implement F157 stage NN. Read ticket.md, plan.md, procedures.md and stages/stage-NN-*.md." Land each split branch with a merge; after its land a failed push needs `git pull --no-rebase` (`CLAUDE.md`). `limen land --keep-open` on all but stage 20.

## Planning progress

- [x] All files written. Scouts: 0 (the job task forbids `limen wait`; the planner read the code).
- [x] Words: see the Log.

## Cold review

Model: `claude-sonnet-5-5` (no `[risky]` stage, no risk area of the board). Started detached; this job may not wait for it. The coordinator files it as `plan-review-1.md` and continues this job for the fixes.

## Log

- 2026-11-20 at ea317d34: plan written. Words: plan.md 1,500, procedures.md 550, stages 4,859 in 20 files (max 418, stage 05).
