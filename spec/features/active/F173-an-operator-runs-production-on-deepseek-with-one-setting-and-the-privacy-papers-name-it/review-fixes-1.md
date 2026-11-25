# F173 review 1 fixes

Answers `plan-review-1.md` (FAIL, four blocking findings, eight notes). No second review (coordinator task).

- **B1 fixed.** New P11 with the review's default: the public page describes the default setup; no `deepseek` row there; the three `ai-provider-*` claims say "The default setup uses OpenAI as the AI model" on a new ledger row, in stage 01 step 3 with the C030 rewrite; tests 11–12 of stage 01; P6 moves the DeepSeek facts to the "does not promise" section; the "shows the `deepseek` row" check is gone. `questions.md` item 10.
- **B2 fixed.** New P9a with the review's default (0 errors, `go` set contains `notification`, `spam`); D7 and stage 03 summary rows state it; O2 reads P9a. `questions.md` item 11.
- **B3 fixed.** Stage 03 run 3 adds the reply injection set with the same provider and judge; P9 drafter pass needs the holdout gate file, all injection cases and at most 2 leaning drafts; own cap $1 in P10.
- **B4 fixed.** Record B lines and ledger rows C182, C184 move to stage 01 step 2–3; the record B fail check moves to stage 01 test 8; stage 02 keeps the DPIA (C209), the public page and the docs.
- **Note 1 fixed.** D1: stage 01 rewords the `checkRealMail` message to "has no sub-processor row, …"; stage 01 test 3 asserts it; the stage 02 grep stays as the acceptance.
- **Note 2 fixed.** Stylist run cut (P8, stage 03); its cap share gone from P10.
- **Note 3 fixed.** P10 recounted: four runs ($2, $2, $1, $2); exit 4 is a resume (same command, no `--fresh`, same cap), total at most $14; stage 03 checks the $20 ledger month cap first.
- **Note 4 fixed.** Stage 01 step 2: OpenAI-only facts, `store: false` included, are not generalised; P4 names the shared adapter.
- **Note 5 fixed.** Stage 02 step 3 updates `reply-drafts.md` rule 17.
- **Note 6 fixed.** Stage 01 test 9 adds `deepseek` to the two `test.each` lists.
- **Note 7 fixed.** P8, D7 and stage 03 step 2: drafter rows name the judge model and prompt version.
- **Note 8 no change.** The review asks none; stage 01 test 10 names both the row-count pin and the per-paper count table.

Words after fixes (`wc -w`): plan 1414; stage 01 700, stage 02 626, stage 03 552.
