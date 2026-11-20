# F157 plan — time and size rules reach test code; test files over 800 lines are split

> **Status 2026-11-20 — planned.** Plan base: ea317d34. No stage built. Repaired after plan review 1.

## Input

Owner words (F125 `audit/report.md` § Questions, question 3, answered 2026-11-20): "yes, as one planned follow-up ticket at low priority: extend the time-literal rule to test files, split the test files over 800 lines, then extend the size lint to tests."

### Decisions

- **D1 Test code.** "Test code" is the list that both rules skip today (`sizeIgnores` in `eslint.config.js`): `**/*.test.{ts,tsx}`, `**/*.spec.ts`, `**/*.test-helper.ts`, `apps/server/test/**`, `apps/*/e2e/**`, `tools/*/test/**`, wherever such a file lives (also `apps/docs/scripts/`, `scripts/`); the time rule also gets `deploy/test/**` (the size rule covers it already). After F157 both rules cover all of it (default, owner to confirm: `questions.md` 1). Rejected: `*.test.ts` only (helpers grow without a limit).
- **D2 Time rule scope.** The `ea/no-time-literals` block adds the D1 globs to its `files`. Its ignores keep `packages/core/src/time.ts` and add `packages/core/src/time.test.ts` (it pins the three values). Rejected: a disable comment there.
- **D3 Time fix.** A hit becomes `MINUTE_MS`, `HOUR_MS` or `DAY_MS` from `@ea/core`, same value, largest whole unit. A local copy (`const MINUTE = 60_000`) goes. A number that is not a time gets a disable comment with the reason. No expected value, timeout or case changes (`procedures.md` § Time fix).
- **D4 Time rule in parts.** Stage 01 fixes the test code outside `apps/server/test/` and `tools/*/test/` and turns the rule on there. Stages 02 and 03 fix int files by name range with no config change. Stage 04 fixes the rest, turns the rule on for all test code, and fixes any hit that other tickets added since. Rejected: one stage (743 hits).
- **D5 Split method.** The F091 history merge (`spec/features/done/2026-11/F091-repo-split/tools.md`, `history-copies.sh`), then the trim commit at once; `git log --follow` reaches the old file from each part. Never rebase or squash; merge `master`. The branch stays unpushed until the land. If `master` changes an old file of the stage after the history merge: port the master diff into the matching part and prove again; if that fails, reset to the new `master` and split again; at most two restarts per stage, then a stop. Steps: `procedures.md` § Split.
- **D6 Parts.** Topics follow the top-level `describe` blocks. Each part is at most 600 lines (headroom under 800; under 400 where a topic allows). Name: `<old base>-<topic>.test.ts` in the old folder; no part keeps the old name. Default, owner to confirm: `questions.md` 2.
- **D7 Same cases.** Every case keeps its `describe` path and name. A `describe` split over two parts keeps its name in both. Tests that share state stay in one part. Setup hooks repeat in each part (or a helper that registers them).
- **D8 Shared code.** A helper used by two or more parts moves once to a helpers file: an existing helpers file of the same area takes it while it stays at most 600 lines (`two-factor-helpers.ts`, `web-helpers.ts`); else `apps/server/test/integration/<old base>-helpers.ts` for int files, `<old base>.test-helper.ts` next to a file under `src/`. A helper used by one part stays in that part. No helper body is copied.
- **D9 Split proof.** Stage 05 adds `scripts/test-audit/split-proof.ts`: it compares the JUnit cases of the old file (at the stage base) with those of the parts, as a multiset keyed by `classname`, `name` and `skipped`, not by file. Each part runs in its own process (`--after` repeats), so a lost hook cannot hide behind a sibling. A changed `assertions` count does not fail the tool; it is a stop unless the log names its cause (a poll).
- **D10 Stage log.** Each split stage writes `split-log/stage-NN.md`: per old file its lines, its parts with lines, the `split-proof` line, the setup list, the assertion lines with their cause, the repointed references.
- **D11 Moving targets.** A listed file at or under 800 lines at the stage `HEAD` is not split; the log says so. Stage 20 measures again: it splits at most 2 late files over 800; with more, it stops and asks for a split stage.
- **D12 Size rule.** Stage 20 deletes `sizeIgnores`, so the 400 warning and the 800 error reach test code. The no-disable scan of `file-size.test.ts` covers test code too. About 173 test files of 401–800 lines then warn; that is accepted (default, owner to confirm: `questions.md` 3).
- **D13 Docs.** Stage 04 and stage 20 change `docs/code-patterns.md` § Size and shape and the comments in `eslint.config.js` that say test code is out. No capability page names these rules.
- **D14 References.** A split repoints, in the same branch, every mention of the old file outside the history folders: capability pages, `docs/code-patterns.md`, `docs/legal/`, public-claim proofs (`apps/docs/src/security/claims.ts`; stage 16), `PAIR_RULES` `test:` strings (stages 08, 09), comments. Reason: tests and the docs build check cited paths, and `check:job` does not run them (F6). Rejected: a stub at the old path.
- **D15 Bare-codes allowance.** `FIXTURE_LABELS` in `bare-codes.test.ts` stays keyed by exact path: each part of an allowed file gets its own entry (stage 11, `channels-card-sync.test.ts`). Rejected: a path pattern (too wide).
- **D16 Collisions.** `history-copies.sh` overwrites an existing file with no warning. No part or helpers path may exist before the history merge (`procedures.md` § Split step 5).

## Facts

In [`facts.md`](facts.md): F1–F6 and what is not verified.

## Done when

1. `bun run lint` fails on `const a = 60_000;` in `apps/server/test/integration/x.test.ts` (case in `time-lint.test.ts`).
2. `bun run lint` fails on an 801-line `apps/server/src/x.test.ts` and `apps/server/test/integration/x.ts` (cases in `file-size.test.ts`).
3. `git ls-files` of test code `| xargs wc -l` shows no file over 800 lines.
4. Every `split-log/stage-NN.md` has a `split-proof PASS` line per split file.
5. No old file path is cited outside the history folders, and the reference checks pass (`procedures.md` § Split steps 10–11).

## Rules for every stage

- Out of scope: any change of what a test checks (expected values, cases, timeouts). A move or a spelling change only.
- A gap: if the answer does not change the stage, take the safe default, note it in the stage log and under `Decisions for the owner`; else write the question to a file in this folder and stop (styleguide). A failing case runs once more; a second failure is a stop.
- Format only the stage's files.
- Never `test:unit` or `test:int`; single files with `bun test <file>` (int files: the env of `check:job`).

## Proof

Split stages first run the reference checks. Last step of each stage: `bun run check:job`; copy its last line (`check:job PASS master=… tip=…`). Stages 04 and 20 also run `bun run lint` once over the whole repo and save the log.

## Review

No stage is `[risky]`. Split stages land on their `split-proof` lines. Stages 04 and 20 change lint config: a `claude-sonnet-5-5` review before the land. No owner checkpoint.

## Stages

Needs lines are in each stage file. Split stages of different files may run next to each other.

- [ ] [01 — time rule: non-int test code](stages/stage-01-time-rule-outside-int.md)
- [ ] [02 — time fixes: int files a–l](stages/stage-02-time-int-a-l.md)
- [ ] [03 — time fixes: int files m–r](stages/stage-03-time-int-m-r.md)
- [ ] [04 — time fixes s–z; rule on for all test code](stages/stage-04-time-int-s-z-and-rule.md)
- [ ] [05 — split proof tool](stages/stage-05-split-proof.md)
- [ ] [06 — split: core digest, digits, notice registry](stages/stage-06-split-core.md)
- [ ] [07 — split: server config and eval](stages/stage-07-split-server-unit.md)
- [ ] [08 — split: actions repo and send](stages/stage-08-split-actions-repo-send.md)
- [ ] [09 — split: actions committer, follow-up, move, drafts](stages/stage-09-split-actions-rest.md)
- [ ] [10 — split: channels notices and commands](stages/stage-10-split-channels-notices.md)
- [ ] [11 — split: channels callbacks, card sync, sender](stages/stage-11-split-channels-rest.md)
- [ ] [12 — split: reply review, follow-up cards, fixtures, lab seed](stages/stage-12-split-a-l-rest.md)
- [ ] [13 — split: mail sync and history backfill](stages/stage-13-split-mail-sync.md)
- [ ] [14 — split: mail jobs and OAuth](stages/stage-14-split-mail-jobs-oauth.md)
- [ ] [15 — split: mail repo, drafter job, reply sweep](stages/stage-15-split-mail-repo-replies.md)
- [ ] [16 — split: privacy erase, retention, reply lifetime](stages/stage-16-split-privacy-retention.md)
- [ ] [17 — split: triage service, triage job, SLO checks](stages/stage-17-split-triage.md)
- [ ] [18 — split: trust history and regate](stages/stage-18-split-trust.md)
- [ ] [19 — split: web two-factor and HTTP](stages/stage-19-split-web.md)
- [ ] [20 — size rule on for test code](stages/stage-20-size-rule.md)

## How to run (coordinator)

Board worker flags (`spec/build.md` TRACK), `--prepare 'bash scripts/limen-prepare.sh'`. Task: "Implement F157 stage NN. Read ticket.md, plan.md, procedures.md and stages/stage-NN-*.md." Land split branches with a merge; a failed push then needs `git pull --no-rebase` (`CLAUDE.md`). `limen land --keep-open` on all but stage 20.

## Planning progress

- [x] All files written. Scouts: 0 (the planner read the code).
- [x] Words (repair 1): plan.md 1,495, procedures.md 971, stage max 504.

## Cold review

Round 1 (`claude-sonnet-5-5`; no `[risky]` stage): FAIL, 4 blocking ([`plan-review-1.md`](plan-review-1.md)). The coordinator starts round 2.

## Log

- 2026-11-20, repair at f4c2a1bc: review findings B1–B4, N1–N3 and N5–N8 fixed (map: `plan-repair-1.md`); N4 not taken.
- 2026-11-20 at ea317d34: plan written.
