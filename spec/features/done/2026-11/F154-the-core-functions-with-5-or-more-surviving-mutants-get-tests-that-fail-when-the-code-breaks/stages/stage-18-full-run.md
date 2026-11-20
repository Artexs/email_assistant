# F154 stage 18 — full core mutation run and the final table

Needs stages 02–17: their new test cases in `packages/core/src` (this run measures them) and their `results/stage-NN.md` files. Needs stage 01: `mutation-gaps.ts`.

Part of [`../plan.md`](../plan.md). Decisions D1, D2, D4, D5, D11.

## Step 1 — full run

**Goal.** One default run of all of `packages/core` (static mutants ignored, as the audit run) at the stage's start commit.

**Check.** `bash scripts/test-audit/mutation.sh /tmp/f154-s18/full` (about 20 minutes at the audit; it takes the run lock).

## Step 2 — final table

**Goal.** `results/final.md` in this ticket folder:

1. The core score from `mutation.log` and the line `audit 86.45 %`.
2. A table of the 122 functions of `audit/review-core-web-tools.md` § GAP: `file | function | audit count | final count | stage`. The audit count is the GAP table value. The final count comes from `bun scripts/test-audit/mutation-gaps.ts --in /tmp/f154-s18/full/mutation.json --min 1`. Use `--by fn` to match the audit rows; an audit row that the D1 row ids split (for example the three `rejected` texts) gets the sum. A function renamed or split by D9 uses the name its stage results file gives.
3. Every function whose final count is 5 or more: the stage results file must list each of its remaining mutants with a D5 class. Name any function where that fails.
4. New GAP functions: functions with 5 or more counted mutants that are not in the 122 (code added after the audit) — a list only; they are not this ticket's work.

**Test cases** (checks on the table, fixed values):
1. 122 rows, one per GAP item.
2. For each of the 10 functions named in `ticket.md` § Scope (the top 10 of `audit/report.md` § 4), final count < audit count.
3. Sum of the final counts of the 122 functions < 1,257.

## Step 3 — score

- Score ≥ 86.45 % → write "score holds".
- Score < 86.45 % → compare per file with the audit's `audit/data/mutation-files.tsv`. When the drop lies in files that no F154 stage touched, record the files and their counts (D11) and say so in the final message; the coordinator opens a follow-up ticket. When the drop lies in an F154 file, the stage of that file did something wrong: stop and report it.

## Done when

- `results/final.md` holds the score line, the 122-row table, the D5 check and the new-GAP list; test cases 1–3 hold.
- Last step: `bun run check:job`.

## Out of scope

- New tests (a gap found here is a question in the final message, not a case written here). `--with-static`.
