# F125 stage 21 — Phase B result: every approved group is done or deferred with its reason

Part of [`../plan.md`](../plan.md) § Phase B. Needs stages 09–20: `audit/cut-s09.md` … `audit/cut-s20.md`. No review job (docs in this folder only; the cut stages had theirs).

Goal: the owner and the next audit see in one place what phase B changed, and plan Done-when item 7 can be checked.

## Step 1 — Report § 6

- Add `## 6. Phase B result` to `audit/report.md`. One table, one row per group G01–G10: `Group | Action | Rows done | Rows deferred | Lines removed (git) | Cases before → after | Int time before → after (s) | Stage log`.
- Lines removed: `git diff --stat` of the group commits (named in each cut log), test files only.
- Below the table, the deferred rows: key, reason (open branch, no or two cases on resolve, failed proof, a found product bug), and what would let a later job finish it.
- A deferred row whose reason has gone at this stage's base (for example the open branch landed): list it as "can run now", with its group. Do not cut it here.
- Found product bugs (D23 rule 5), each with the row and the observed value: also in the final message, as follow-up ticket proposals for the coordinator.

## Step 2 — README

- `scripts/test-audit/README.md` § Cut proof: add what the cut stages learned that a later cut needs (for example a flaky lcov file, a mutation run time per stage). Facts only, from the cut logs.

## Done when

- Report § 6 has 10 rows and every key of `audit/approval-groups.tsv` is done, deferred with a reason, or rejected (`audit/reject.tsv`); the count check is in `/tmp/f125-s21/count.log` (counted in keys, as `cut-keys` prints them: done + deferred + rejected = 189 keys, that is 185 approved keys and the 4 rejected keys; the `rows` column of `approval-groups.tsv` sums to 101 items and is not this count).
- One commit with explicit paths.
- No `check:job` (no code change); the final message says so.

## Coordinator record (not a stage)

Plan Done-when item 7 also needs `test:unit:ci` and `test:int:ci` green on master after the last cut land: read the CI lines of `scripts/coord-scan.sh`. The ticket closes on the land of this stage.
