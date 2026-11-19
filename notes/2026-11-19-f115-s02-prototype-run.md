# F115 stage 02: prototype run (reply drafter on lab-01)

Status at the end of the job: the harness and the injection set are built and tested; the dev run is done; the holdout run is NOT complete (partial state only); the injection report is described below if it finished. Real spend rule: every real run used `--budget-usd 1`.

## What exists

- Harness: `bun run eval --sim lab-01 --part dev|holdout|week --drafter [--judge]` and `bun run eval --set reply-injection --drafter --judge`. Code: `apps/server/src/scripts/eval-drafter.ts`, `apps/server/src/modules/replies/drafter-eval*.ts`, `judgeReplyDraft` in `apps/server/src/modules/triage/eval-judge.ts`. Docs: `evals/README.md` § Reply drafter eval.
- Injection set: `evals/cases/reply-injection.json` (14 cases).
- Judge: Gemini `gemini-3.5-flash-lite` (the default Gemini model of the config); drafter `gpt-6-luna` with `--reasoning-effort low`. Run flags: `--model gpt-6-luna --reasoning-effort low --judge-provider gemini --budget-usd 1`.

## Dev tuning (dev part only; holdout never read for tuning)

All numbers are over the drafts of the dev part (81 `needs_reply` cases, 1 skipped for language `de`). Cost of each dev run: $0.05 to $0.08.

| text of drafter-v1 | effort | drafts | send as is | invented commitment | code checks (after retry) | needs_facts |
| --- | --- | --- | --- | --- | --- | --- |
| as landed in stage 01 | none | 74 | 37 (50%) | 6 | 74 of 75 | 5 |
| as landed in stage 01 | low | 68 | 47 (69%) | 4 | 68 of 70 | 10 |
| tuned 1 (formal greeting rule, "never skip a decision"), dropped | low | 74 | 43 (58%) | 1 | 74 of 79 | 0 |
| tuned 2 (final; kept in `drafter-v1.ts`) | low | 78 | 50 (64%) | 1 | 78 of 78 | 2 |

- Tuned 2 adds two sentences: short gap labels with no quote or line break, and "never write that the manager will check, consult, decide or answer later; ask the sender for nothing that the email does not ask". Tuned 1 made form of address worse (21 drafts with score 0) and caused 5 gap-syntax failures: dropped.
- Low reasoning effort is better than none on dev (50% to 69% with the old text) at the same cost (about $0.0007 per draft). This is a config value (`LLM_DRAFTER_REASONING=low`), not a code change. PD-072 stays open.
- The text of `drafter-v1.ts` changed in place, because no holdout run existed yet (the file header says so). A change after a complete holdout run is `drafter-v2`.
- Dev report (final text): `evals/results/2026-11-19-sim-lab-01-dev-gpt-6-luna-drafter-v1-reply.md`. Earlier dev states: `.f115s14-logs/dev-*` (untracked).

## Findings the second pass must read

1. **Judge artifact on English cases.** The corpus writes `expectedPoints` in Polish for English mails. The judge flags `language_matches` false on English drafts: dev final, 11 of 31 English drafts, 1 of 47 Polish drafts. I checked two dev drafts by hand: both were English. Without that check the send-as-is rate on dev is 53 of 78 (68%) instead of 50 of 78 (64%). A judge change is `judge-v2`; I did not make it.
2. **Gaps count as "not answered".** Most `needs_reply` mails ask a decision that only the manager can make. The correct draft is a gap. The judge rubric item `answers_every_question` scores such a draft 0 or 1. So "send as is" cannot reach 80% while the rubric stays as it is. Every dev draft of the final text holds a gap (78 of 78).
3. **Dev numbers against the bars (final text, low effort):** code checks 100% (pass), planted strings 0 (pass), invented commitment 1 (bar 0: fail), send as is 64% (bar 80%: fail), `needs_facts` share 2 of 80 (inside the 30% line). Cost per draft about $0.0007.
4. **Gemini quota.** The judge key answered 429 often during the holdout run (78 retries by 164 cases). A full holdout run then takes about 45 minutes at 12 rpm plus retries.

## Holdout run: NOT complete

- Command (resumes from the saved state): `bun run eval --sim lab-01 --part holdout --drafter --judge --model gpt-6-luna --reasoning-effort low --judge-provider gemini --budget-usd 1 --out evals/results/2026-11-19-sim-lab-01-holdout-gpt-6-luna-drafter-v1-reply.md`. The state file `evals/.runs/gpt-6-luna-low-drafter-v1-drafter-sim-lab-01-v1-holdout.jsonl` (gitignored; copy in `.f115s14-logs/holdout-partial-state.jsonl`) holds 171 of 260 results. Cases whose judge call failed (13) run again on resume.
- I stopped the process by its PID when the time ran out. The spend ledger got no line for the part of the run that was done (about $0.1 to $0.2, unrecorded). The stale lock file was removed.
- Counts only of the 171 partial results (completion order, not a clean prefix, no gate file): 164 drafts, 7 `no_draft` (all `needs_facts`), 0 failed, 0 planted strings in a draft; of 151 graded drafts, 97 send as is (64%) and 5 with `no_invented_commitment` false; 13 judge errors.
- The gate file `evals/results/gate/drafter-drafter-v1-gpt-6-luna-low-lab-01-v1.json` does not exist yet. A resume run writes it and the report.

## Not verified in this job

See the final message of the job: which parts of the PROOF chain ran.
