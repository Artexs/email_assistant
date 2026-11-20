# Plan review 3: F125 cut stages 08–21 (cold review, no suite run)

Read at `96ebacd8`. Read: `plan.md` § Phase B, stages 08–21, `questions.md` Q7–Q10, `audit/report.md` § 2–3, `audit/approval-groups.tsv`, `audit/data/cases.tsv`, the three review files, and the code that the stages name. Checks were done with read-only commands on the TSV files and `git`. No suite, lint or typecheck ran. No file outside this review was changed.

## Blocking findings

**1. Stage 08 `cut-keys` cannot find 11 approved keys by name, and its kept-key path is wrong for stage 12.** Proven.
- `cut-keys` takes the old name of a key from `audit/data/cases.tsv`. 11 approved keys have no row there: `deploy/test/compose-lib.test.ts:54`, `:67`, `:73` (G03, stage 14); `deploy-logging.test.ts:372`, `start/runs.test.ts:33`, `:52`, `platform/config-deepseek.test.ts:85`, `platform/config.test.ts:221`, `:295`, `:459`, `scripts/e2e-job-env-args.test.ts:70` (G09, stage 19). A twelfth, `time-rewrite-check.test.ts:43`, is on the reject list and its file is gone.
- Cause: the core/web/tools review (base `535e6f76`, continuation `1d4db8b4`) and the server-unit review (base `3cf7113e`) took their keys from fresh scans, not from `cases.tsv` (the stage 02 base). The int review used `cases.tsv`. For the keys that exist in `cases.tsv` the names fit (I compared the `shapeGroup` of every G03, G04 and G05 key per file: one consistent group each), so only the missing ones fail.
- The kept keys of stage 12 have the same flaw. They are HEAD lines, but `cut-keys` looks them up in the old rows. `org-export-args.test.ts:18` was "a missing or bad argument gives null" in `cases.tsv`; at HEAD it is "…throws a usage error" (renamed by the CLI-standard change). It resolves to `deferred-none`, so the row defers for the wrong reason. `rules.test.ts:157` is now line 158 and `mailbox-settings-args.test.ts:138` is now 155, so they resolve only by luck of the name.
- Effect: stages 14 (3 keys), 19 (8 keys) and 12 (up to 4 kept keys) would defer rows that are approved and exist. Q10-style "defer, do not guess" hides the loss.
- Fix in stage 08: write `audit/data/approved-keys.tsv` (`key`, `file`, `describePath`, `name`) from fresh scans at the three review bases (`scan-cli.ts` on a `git worktree` or `git archive` of `535e6f76`/`1d4db8b4`, `3cf7113e` and the `cases.tsv` base), and let `cut-keys` read it first and `cases.tsv` second. `--keys` takes either a key of that file or `<file>::<name>` for a kept case at HEAD. Check `audit/reject.tsv` before any lookup, so the gone file gives `rejected`, not an error. Add a status for "key not in any old source" and a test (T7).
- Add to Done when: `cut-keys --group Gnn` for all ten groups against a scan at the stage base prints no "key not in any old source" row, and the 4 rejected keys show `rejected` (log `/tmp/f125-s08/keys.log`).

**2. Stage 11 step 1 builds a table that already exists, and its `--expect` cannot hold.** Proven.
- `apps/server/src/scripts/stats-week-args.test.ts` already has one `test.each` with seven argument lists (no argument, not a Monday, 30 February, bad org id, bad mailbox id, an operand, an unknown flag), each `toThrow(UsageError)`. The six lists of the int case are all there. The task of the stage is therefore only to cut the int case from six spawns to one.
- As written, the worker adds six near-copy rows (a § Tests violation in `docs/code-patterns.md`), and `--expect unit=+7,int=-1` fails the proof: the real delta is `unit=+1` (the bounded close) and `int=-1` (the bounded close; the stats:week case stays one case).
- Fix: step 1 = confirm each of the six lists has a row in the existing table (name the row for each, in the log), exact-message assert if the table lacks it is a separate rewrite and out of scope; then cut the int case to the empty-argument spawn. `--expect unit=+1,int=-1`. Break once: the `UsageError` of `parseStatsWeekArgs` for one list, see the existing row fail (as now), and the remaining spawn keeps the wiring check. Rewrite D16 and the stage title ("move" becomes "cut to one spawn"); Q7 stays the same default.

**3. Stage 21 "Done when" counts the wrong thing.** Proven.
- It says every key of `audit/approval-groups.tsv` is done, deferred or rejected, and "done + deferred + rejected = 101 rows". 101 is the sum of the `rows` column (items or T groups). The file holds 189 keys (G01 13, G02 5, G03 52, G04 37, G05 29, G06 2, G07 20, G08 3, G09 21, G10 7). The cut logs and `cut-keys` count keys. A worker cannot make both statements true.
- Fix: say 189 keys (185 plus 4 rejected), or count `rows` and say so. Pick keys: it is what `cut-keys` prints.

## Non-blocking notes

1. **G02 may defer most pairs; expect it.** At HEAD the kept `org-export-args.test.ts` case asserts a bare `toThrow()` four times, with no exact message or `UsageError`. The CLI case it would replace checks exit 2 and the usage line. D18 ("at least as strict") then fails and the pair defers. That is the right outcome, not a plan error; the coordinator should not read it as a failed stage. The same check applies to the other kept cases.
2. **Mutation runs and "no full suite more than once".** Stages 16 and 20 run `mutation.sh --mutate <closure>` twice. Stryker's initial dry run executes the whole `packages/core` suite (2.8 k cases) each time, plus per-test coverage. Q9 and D14 say "stage files only". Add one line to D14: the Stryker dry run of the core suite is the only full-suite run, runs twice, and is the audit tool, not `test:unit`. No other stage runs a full suite more than once: stage 18 runs the full suites once through `check:job` (its own rule, `package.json` changed) and a one-folder `bun test`; the other stages run `cut-run` on their own files (twice before, once after) and a `check:job` that only runs tests importing a changed file.
3. **`cut-proof` and a lane with no "before" file.** Stage 09 has no unit file before, so `before/unit.xml` is missing. Say in stage 08 that a missing lane counts as 0 cases and 0 lines, so `--expect unit=+6` can hold.
4. **Mutation-unstable count.** Stage 08 says "the 6 places" of README § Mutation notes. The README names 5 locations (`digits.ts` 297:21, 368:17, 372:23, `batch.ts` 107:5, `suspicious.ts` 342:7) for 6 status differences. Say "the places listed there".
5. **Rows in an open branch.** `config.test.ts` (stage 19) was named as blocked at planning time. No `limen/*` branch is unmerged for it at `96ebacd8` (five are open: two F138, one F111, two F102). Rule S3 at the stage base decides; the plan text is right.
6. **Stage 11 bounded close.** Verified: `client.test.ts` exists next to `createImapMailProvider`, `CLOSE_LOGOUT_TIMEOUT_MS` is exported at 3,000 and the timer is `setTimeout(…, CLOSE_LOGOUT_TIMEOUT_MS)`. The int case builds the provider over a stub client, so it needs no GreenMail; the move is sound.
7. **Plan size.** `plan.md` is about 6,500 words against the 1,500 cap (already noted in review 2). Each stage file is under 700 (stage 08 has 698).

## Checks of the task

| Check | Result |
| --- | --- |
| Every group G01–G10 has a stage | Yes. G01: 09 (6 keys), 10 (5), 11 (2) = 13. G02: 12 (5). G03: 13 (27), 14 (16), 15 (9) = 52. G04 and G05: 16 (37 + 29; 12 files). G06: 17. G07 and G08: 18 (23). G09: 19 (17 + 4 rejected = 21). G10: 20 (7). Key counts match `approval-groups.tsv`. |
| Reject keys stay untouched | Design holds: `audit/reject.tsv` (4 keys), `rejected` status checked in `cut-keys`, stage 19 names them. The lookup order must change (finding 1) so the gone `time-rewrite-check` key does not error. |
| One worker job per stage, observable Done when | Yes, except stage 11's `--expect` (finding 2) and stage 21's count (finding 3). Stage 16 is the largest (66 keys, two mutation runs) but still one job (145 test lines). |
| Needs lines are true | Yes. F154 stages 11, 12 and 14 have result files in `spec/features/planned/F154-…/results/` and their branches are ancestors of `HEAD` (`git merge-base --is-ancestor`; the other F154 test stages are merged too). Stage 20's F154 stage 12 is merged. Stage 10 needs stage 09's helper; the other stages need only stage 08 or a file on master. No Needs line says "stages landed". |
| Stage 08 tools find each approved test by name | **No** for 11 keys and the kept keys of stage 12 (finding 1). For the other 177 keys: no `(file, describePath, name)` triple repeats in `cases.tsv`, so none would resolve to two. |
| No stage runs a full suite more than once | Yes, with note 2 (the Stryker dry run). |
| No product code changes | Yes. Stage 09 adds a `*.test-helper.ts` (the folder already has `serve-lock-holder.test-helper.ts`); 17 changes `ci.yml`; 18 changes `package.json` and a README of a tool; 11, 19 and 20 break product lines only to see a test fail, then restore. |

## Verdict

FAIL: three blocking findings (1: 11 approved keys and the kept keys cannot be found by name; 2: stage 11 duplicates an existing unit table and its `--expect` is wrong; 3: stage 21 counts 101 rows against 189 keys). Fix them and the plan can build; no new question for the owner arises.
