# F173 stage 03 — DeepSeek sim gate runs and the summary

Coordinator only: real LLM spend on the DeepSeek key of the main `.env`. Needs nothing from stages 01–02 (the sim tools already run on DeepSeek). May run next to 01 and 02.
Part of [`../plan.md`](../plan.md).

## Step 1 — the gate runs

- **Goal:** each role that serves mail and has an open decision has a gate result on DeepSeek.
- **Decisions:** P8, P9, P9a, P10.
- Prompt versions: the production version of each role at `HEAD` (`prompts` registry). Read the flags with `bun run eval --help`; holdout parts only; never open `holdout/` by hand.
- Runs, each with `--provider deepseek`:
  1. Classifier, `--budget-usd 2`: `bun run eval --sim lab-01 --part holdout`. Bar: ≥ 200 holdout cases per category and the Wilson 95 % lower bound of precision ≥ the bar (PD-024, PD-025, ADR 0028). Pass rule for O2: P9a (0 errors; `go` set contains `notification` and `spam`).
  2. Drafter holdout, `--budget-usd 2`: `bun run eval --sim lab-01 --part holdout --drafter --judge` (default judge, P8). Bars: the gate file bars, plus the leaning-sentence count of the switch rule (at most 2 drafts).
  3. Drafter reply injection set, `--budget-usd 1`: `bun run eval --set reply-injection --drafter --judge`, same drafter, provider and judge as run 2. Bar: all cases pass (PD-083).
  4. Extractor, `--budget-usd 2`: `bun run eval --sim lab-01 --part sent-holdout --extractor`.
- No stylist run (P8): `style_from_sent` stays off whatever the result.
- Exit 4 (cap or error limit): resume once with the same command, no `--fresh`, same cap (P10). A second stop: "not run". Before run 1, check that the spend ledger month total leaves room for $14 under the $20 month cap; else stop and ask.
- A tool that refuses `provider: deepseek` in a gate file, or writes no gate file: stop and ask.
- **Test:** the classifier gate file parses: `bun test apps/server/src/modules/triage/gate-evidence.test.ts` passes with the new file present.
- **Out of scope:** prompt tuning, a new prompt version, the judge and stylist roles.

## Step 2 — the summary file and the role limits

- **Goal:** the owner and O2 read one file to see which roles may run on DeepSeek.
- **Decisions:** P9, P9a, D7.
- Write `evals/results/deepseek-gate-lab-01.md`: one table row per run: role, prompt version, model and effort, command, gate file path or failing number with its bar, cost in USD, flag decision of P9. Drafter rows also name the judge model and judge prompt version (the OpenAI files used `gpt-6.1-terra`, `judge-v3`). Classifier row: "go set: …; OpenAI go set: notification, spam; O2 yes/no". A drafter decision line: on only when runs 2 and 3 both pass.
- Add one line to the Limits of each role's capability page (`triage.md`, `reply-drafts.md`, `open-loops.md`): the DeepSeek gate result and the summary path.
- Commit the gate files, the reports and the summary with explicit paths.
- **Out of scope:** flag changes on the VPS (O2).

## Done when

- One row per run in the summary: a gate file path, or "off" with the failing number, or "not run" with the cap reason.
- The classifier row states the P9a answer (O2 yes or no).
- `bun run check:job` passes (its last line in the final message).
- The final message lists the total spend.
