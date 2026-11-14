# F091 plan review 1

Job `2026-11-13-f091-plan-review-a81c794b` (Opus 5.5, high), candidate `1a15cbc`. Final message, filed whole:

PASS 1a15cbcd2c6d8342abcbeb982dd4be6c4d8c379e

The F091 plan holds. I found no blocking finding. I ran all four tools.md scripts on a scratch clone, and they work: both splits typecheck, lint and pass the unit tests, and `--follow` keeps the old history. The worst risk is outside the stage branches. The repo's own push-recovery rule (`git pull --rebase`) breaks the history merge on `master` (N1). Two mutation checks name the wrong failing cases, so a worker can stall on them (N2, N3).

HEAD = candidate: `git rev-parse HEAD` printed `1a15cbcd2c6d8342abcbeb982dd4be6c4d8c379e` (saved in `/tmp/f091-review/head.log`). The worktree is unmodified: `git status --short --untracked-files=all` printed nothing (`/tmp/f091-review/status.log`, 0 bytes). All work ran in `/tmp/f091-review/clone`, a clone checked out at the candidate, after `bun install --frozen-lockfile`.

## Blocking findings
None.

## Unverified
- **`bun run test:int` / `test:int:ci` on the split: not run.** This worktree has no `.env` and no job DB. The plan already lists this (`plan.md:112`).
- **The post-F086 `actions-map.json` (`tools.md:295-415`) on a real post-F086 file: not run.** F086 is not landed at HEAD. Run as written, the map stops with `error: not in the map: ExpireFilter`, which is the expected result before F086. I ran a pre-F086 copy of the map instead (`PayloadKeepRule` removed, `ExpireFilter` added to `expiry`). It passed every check (see "Checks run").
- **`bunx madge@8.0.0` (stage 03 check 4): not run.**
- **The stage 03 and 04 code: not prototyped.** I checked it against the source text only.

## Notes

Each note is labelled major or minor and by how sure it is: proven, plausible, or unverified.

**N1. Major, proven mechanism, plausible trigger. Two rules conflict, and the history merge on `master` can be lost.**
- `plan.md:130` forbids a rebase only on the stage branch.
- `CLAUDE.md` says a `PUSH FAILED` line needs `git pull --rebase && git push`. This checkout has `pull.rebase=true`.
- Reproduction in the clone:
  1. I landed the split branch into a stand-in `master` with `git merge --no-edit`.
  2. I gave a stand-in origin one other commit.
  3. I ran `git rebase fakeorigin`, which is what that pull does.
  - Result: `Could not apply d18706f... History copy: …mail/repo.ts as …mail/repo/mailboxes.ts`, with status `DD …/mail/repo.ts`, `UA …/repo/mailboxes.ts` (`/tmp/f091-review/rebase.log`).
- So after the land of stage 01 or 02, one failed auto-push plus a moved origin either stalls the agent in a conflict or flattens the merge, and `--follow` is lost.
- Fix: say in `plan.md` § How to run (item 4) that a `PUSH FAILED` after an F091 land is fixed with `git pull --no-rebase` (or `--rebase=merges`), never with a plain `pull --rebase`. Put the same sentence in the stage 05 § Size and shape bullet (`stage-05:162`).

**N2. Major (a worker can stall), proven. The stage 03 mutation check names the wrong failing cases.**
- `stage-03:206` says that adding `"follow_up"` makes cases 2, 3, 4 and 5 fail.
- Cases 6 and 7 (`stage-03:200-201`) also fail: they read `APPLY_HANDLERS[t].needs`, and the new type has no entry, so it throws a TypeError.
- I reproduced this in `/tmp/f091-review/mut.test.ts`: `TypeError: undefined is not an object (evaluating 'APPLY_HANDLERS[t].needs')`, and case 6 and case 7 fail.
- The typecheck will also fail in more places than the two it names: `would-do.ts` `phrase` (TS2366), `policy.ts` (`never`) and `TYPE_RANK`.
- `stage-01:64`-style wording ("each must give the stated result") makes a careful Sonnet worker stop and ask.
- Fix: "cases 2–7 fail; typecheck fails at least in `completeness.test.ts` and `apply.ts`".

**N3. Minor, proven. The same class of error in stage 04.**
- `stage-04:133` says that adding `"follow_up"` to `draftKinds` makes cases 1 and 3 fail (and 2).
- Case 4 (`stage-04:128`) also fails: `DRAFT_TEMPLATES[kind]` is not a function. The same `mut.test.ts` case reproduced it.

**N4. Major, proven by text. Two rules conflict in `docs/code-patterns.md` once both tickets land.**
- F086 § Size and shape (`spec/features/active/F086-module-borders/stages/stage-05-standards.md:45`) says: "A new kind is a new entry, not a new `if` or `case` in a shared function".
- F091 D18 (`plan.md:87`) adds `case` lines to `payloadOf`.
- The F091 checklist (`stage-05:177,178,183`) tells the next worker to add a `case` to `decidePolicy`, `payloadOf` and `phrase`.
- `plan.md:108` says stage 05 "adds to them and does not repeat them", but nothing reconciles the two rules.
- Fix: stage 05 should add one sentence. Example: "an exhaustive `switch` with no `default` (typecheck fails on a missing case) is allowed where a record does not fit".

**N5. Minor, proven by text. Order gap: stage 05 needs stage 02, but neither the ticket nor the run order says so.**
- `ticket.md:32` says "03, 04, 05 run in order after 01".
- `plan.md:186` says "05 after 04 lands", and `plan.md:211` does not name 02.
- Stage 05 documents `mail/repo/` files (`stage-05:158,225`), and its header says "Needs stages 01–04 landed" (`stage-05:145`), but:
  - stage 01–04 do not include stage 02;
  - stage 05 has no precondition check for stage 02;
  - its `ls` list (`stage-05:206`) has no `mail/repo/*` file.
- If 02 is slow, stage 05 can document files that do not exist, and all its checks stay green.
- Fix: add `ls apps/server/src/modules/mail/repo/targets.ts` to the stage 05 precondition, and state "05 after 02 and 04".

**N6. Minor, plausible. The `git merge master` catch-up makes the no-importer-change checks fail.**
- `plan.md:130` and `plan.md:209` say: catch up with `git merge master`.
- Stage 01 check 6 (`stage-01:71`), stage 02 check 6 (`stage-02:168`) and `plan.md:120` diff against the saved `base.txt`.
- After the merge, the diff also shows test or script changes that other tickets landed on `master`, so the check fails without a fault.
- Fix: after a catch-up merge, use the merge base or diff only the branch's own commits.

**N7. Minor, plausible. No recovery step if the run stops between the history merge and the trim commit.**
- After `stage-01:40` / `stage-02:138`, HEAD is a merge commit that does not build.
- If `split-repo.ts`, the formatter or check 7 fails after that point, no step tells the worker how to go back (`git reset --hard "$(cat /tmp/f091-sNN/base.txt)"` on the unpushed branch, then retry).
- The dry run (item 3) lowers the risk, but a worker would have to guess.

**N8. Minor, proven by text. The reviewer prompt does not say how to get the old file or the base.**
- `plan.md:206` tells the reviewer to rerun the stage's Check commands.
- Checks 3, 4 and 6 need `/tmp/f091-sNN/{actions,mail}-repo.ts`, `exports-old.txt` and `base.txt`, which the worker made.
- The prompt does not say they come from the first parent of the history merge (`<merge>^1`).
- If the reviewer copies the scripts into the same `/tmp/f091-sNN/`, it also overwrites the worker's files.
- Fix: name `/tmp/f091-rNN/` and the `^1` base.

**N9. Minor, proven. Wrong cross-references and line numbers.**
- `tools.md:9` "(plan.md D3)": the history merge is D7.
- `tools.md:293` "(plan.md D5)": the post-F086 map is D21.
- `plan.md:83` "`apply.ts:73`": `inTransaction` is at `apply.ts:81` at HEAD.
- `stage-01:15` says "clean before item 3", but the merge is item 4 (stage 02 says item 4).

**N10. Minor, proven. One importer is missing from the D6 list.**
- `tools/fake-telegram/test/setup.ts:13` imports `../../../apps/server/src/modules/mail/repo`.
- It is in `test:int`, but `plan.md:75` and `stage-02:115` do not name it.
- It resolves without an edit: `bunx tsc --noEmit -p tools/fake-telegram/tsconfig.json` exits 0 on the split clone. So only the list is incomplete.

**N11. Minor, proven by text. Small conflicts and drift.**
- `stage-05:162` says "`repo/shared.ts` holds only … (`DbOrTrx`)", but D11 (`plan.md:80`) also puts `actionTypeSchema` there.
- `stage-05:196` uses the pattern `grep -rn 'kind === "'`. At HEAD it finds 135 hits, most of them not draft kinds.
- Board drift: `docs/product/stage-2/07-foundation-plan.md:15` says 4 stages, and the plan has 5. The plan already says so (D19).

**N12. Minor, plausible. Stage 03 test case 5 may stop compiling after F088.**
- F088 D13 (`spec/features/planned/F088-notices-as-facts/plan.md:29`) narrows `describeActions` to `WouldDoAction` (a `Pick`).
- If F088 also narrows `describeAction`, the object literal of case 5 (`stage-03:199`, with `id`, `reversesActionId`, `appliedAt`) fails the excess-property check.
- The stage does not tell the worker to check the parameter type first.

**N13. Minor, unverified. The madge check is fragile.**
- `stage-03:168` runs `grep -c "actions/apply"`, which also matches `actions/apply-shared.ts`.
- From the import lists I see no cycle through `apply-shared.ts`, so it should print 0. I did not run madge.

## Pre-mortem summary
- **History lost:** not in the stages. The scripts keep it, also through a `--no-edit` land into a `master` that has moved. The only path I found is N1, after the land.
- **Bug reaching the user:** stage 03 keeps the committer's IMAP, SMTP, facts and sort-folder decisions equal for every type. I checked the four sites at `committer.ts:117,334,351,358` against the table at `stage-03:151-157`. `applyAction`'s order is unchanged.
- **Worker stuck:** N2, N3, N7.
- **Stage size:** no stage is too big for one job.

## Checks run, all in /tmp/f091-review/clone
- **Mail split:**
  - `history-copies.sh` printed `history merge 891773f… with 10 copies`.
  - `split-repo.ts` printed `wrote 11 files`.
  - The largest file is `folders.ts`, 257 lines.
  - `same-bodies.ts` printed `SAME_BODIES 77`, and the export diff matched (`EXPORTS_SAME`).
  - The `--follow` loop printed no `NO HISTORY` line, with 51 log lines per file.
  - After a `--no-edit` merge into a stand-in `master` that had moved, `grep -c b786f27` printed 1.
- **Actions split (map without the F086 changes):**
  - `history-copies.sh` printed `… with 13 copies`; `split-repo.ts` wrote 14 files.
  - The largest file is `claims.ts`, 281 lines.
  - `same-bodies.ts` printed `SAME_BODIES 92`, and the export diff matched (`EXPORTS_SAME`).
  - The `--follow` loop to `cca481b` printed no `NO HISTORY` line.
- **Both splits applied:**
  - `bun run typecheck`: exit 0 (`/tmp/f091-review/typecheck.log`).
  - `bun run lint`: exit 0 (`/tmp/f091-review/lint.log`).
  - `bun run test:unit` (Bun 1.4.4): 1877 pass, 0 fail (`/tmp/f091-review/unit.log`).
- **`bun run graph:modules`:** `Script not found` at HEAD. F086 stage 04 adds it, so this is expected.
- **Facts checked:**
  - Line counts: 1776, 1251 and 414.
  - First commits: `cca481b` (28 commits) and `b786f27` (40 commits).
  - Importers: 12 + 13 files, and 51 test/script files.
  - `repo.ts` mentions: only `transitions.ts:576,583`.
  - `actions-transitions.test.ts:68-79` compares the CHECK lists.
  - `describeAction` phrases.
  - `ALL_TYPES` is a literal list.
  - `tsconfig.base.json:5` is `Bundler`.
  - Limen `mergeBranch` uses `merge --no-edit` (`limen/src/project/git.ts:255-257`).
  - The F086 lint zones still refuse a deep import into `repo/index.ts`.
  - ADR 0003 has the approval record.

## Verdict
PASS. 0 blocking. Notes: 13 (3 major: N1, N2, N4; 10 minor). Unverified: 4.

## Note check
- **Each finding quotes file and line:** proven. The evidence is this message: each of N1–N13 names `path:line`. No file holds it until the coordinator files it.
- **tools.md scripts tested on a scratch clone, not the worktree:** proven, with one gap.
  - Saved logs from the split clone: `/tmp/f091-review/typecheck.log`, `/tmp/f091-review/lint.log`, `/tmp/f091-review/unit.log`, `/tmp/f091-review/rebase.log`.
  - The outputs of `same-bodies.ts`, `exports-of.ts` and the `--follow` loops were seen in this session but not saved to a file.
- **The final message starts `PASS <sha>`/`FAIL <sha>` and ends with the verdict and counts:** proven. The evidence is this message: the first line is `PASS 1a15cbcd…`, and § Verdict gives the counts.
- **Easy-to-miss rule "never modify the worktree":** followed. `/tmp/f091-review/status.log` (the `git status --short --untracked-files=all` output) is 0 bytes, and `/tmp/f091-review/head.log` holds the candidate sha.
