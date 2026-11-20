# F157 plan repair 1 — fixes for plan review 1

Base: f4c2a1bc (the commit that filed [`plan-review-1.md`](plan-review-1.md)). One line per finding: where the fix is.

- **B1** (split breaks `capability-map.test.ts`): plan D14 and Done when 5; `procedures.md` § Split step 10 (repoint every mention outside `spec/`, `notes/`, `docs/owner-decisions.md`, `docs/decisions/`, `docs/product/`) and step 11 (the reference checks, which `check:job` does not run); each split stage 06–19 has § References at ea317d34, a Done when line and the checks in its Proof; stage 20 applies the same steps to a late split.
- **B2** (stage 16 breaks the docs build): stage 16 § Public claim C060: the `proofs` in `apps/docs/src/security/claims.ts` and row C060 of `docs/legal/claims.md` name the same parts; `claims.test.ts` and `legal-papers.test.ts` pass. `questions.md` 5.
- **B3** (stage 11 breaks the bare-codes scan): plan D15 (exact path keys, one entry per part); stage 11 § Bare-codes allowance. No other split file is in `FIXTURE_LABELS`.
- **B4** (`history-copies.sh` overwrites a sibling): plan D16; `procedures.md` § Split step 5 (name check with the sibling list of the review, plus `git diff --name-status` shows `D` and `A` only).
- **N1**: step 3 (setup list), step 8 (one process per part), step 9 (an assertions line is a stop unless the log names its cause); plan D9; stage 05 CLI takes `--after` more than once, test case 8.
- **N2**: plan D5 and `procedures.md` § Split, Master moved: port first, then restart, at most two restarts; the branch stays unpushed.
- **N3**: Needs lines of stages 01, 02, 03 and 05 name the F125 cut stages 09–20.
- **N4**: not taken (the repair task listed only the cheap findings). Stage 04 stays one stage; stages 17–19 wait for it. A split of its s–z fixes into their own stage would let them start earlier.
- **N5**: plan D1 and stage 01 add `deploy/test/**` to the time rule, with a test row.
- **N6**: stages 08 and 09 § `PAIR_RULES` pointers.
- **N7**: plan § Rules for every stage takes the styleguide rule (safe default when the answer does not change the stage); `procedures.md` § Split step 2: a failing case runs once more, a second failure is a stop.
- **N8**: plan D8 names the existing helpers files; stage 12 lists exports with the TypeScript checker; the plan's stage list is unticked (no stage built).
- Facts F1–F5 and "Not verified" moved to [`facts.md`](facts.md) to keep `plan.md` under 1,500 words; F6 added.
