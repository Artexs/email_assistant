# F173 stage 03 — DeepSeek sim gate runs and the summary

Coordinator only: real LLM spend on the DeepSeek key of the main `.env`. Needs nothing from stages 01–02 (the sim tools already run on DeepSeek). May run next to 01 and 02.
Part of [`../plan.md`](../plan.md).

## Step 1 — one gate run per role

- **Goal:** each role that serves mail has a gate result on DeepSeek.
- **Decisions:** P8, P9, P10.
- Prompt versions: the production version of each role at `HEAD` (`prompts` registry). Read the flags with `bun run eval --help`; holdout parts only for the gate; never open `holdout/` by hand.
- Runs, each with `--provider deepseek --budget-usd 2`:
  1. Classifier: `bun run eval --sim lab-01 --part holdout`. Bar: ≥ 200 holdout cases per category and the Wilson 95 % lower bound of precision ≥ the bar (PD-024, PD-025, ADR 0028).
  2. Drafter: `bun run eval --sim lab-01 --part holdout --drafter --judge` (default judge, P8). Bars: the ones in the gate file (`codeChecks`, `inventedCommitments`, `sendAsIs`, `plantedLeaks`, `needsFactsShare`).
  3. Extractor: `bun run eval --sim lab-01 --part sent-holdout --extractor`.
  4. Stylist: the style gate as `docs/capabilities/reply-drafts.md` describes it, smoke first (`bun run eval:style-gate --smoke`, dev part). A smoke fail ends the stylist run; record its numbers.
- A run stopped by the cap: one rerun at `--budget-usd 4` (P10). A second stop: "not run".
- A tool that refuses `provider: deepseek` in a gate file, or writes no gate file: stop and ask (plan § Not verified).
- **Test:** the classifier gate file parses: `bun test apps/server/src/modules/triage/gate-evidence.test.ts` passes with the new file present.
- **Out of scope:** prompt tuning, a new prompt version, the judge role.

## Step 2 — the summary file and the role limits

- **Goal:** the owner and O2 read one file to see which roles may run on DeepSeek.
- **Decisions:** P9, D7.
- Write `evals/results/deepseek-gate-lab-01.md`: one table row per role: role, prompt version, model and effort, command, gate file path or failing number with its bar, cost in USD, and the flag decision of P9.
- Add one line to the Limits of each role's capability page (`triage.md`, `reply-drafts.md`, `open-loops.md`): the DeepSeek gate result and the summary path.
- Commit the gate files, the reports and the summary with explicit paths.
- **Out of scope:** flag changes on the VPS (O2).

## Done when

- One row per role in the summary: a gate file path, or "off" with the failing number, or "not run" with the cap reason.
- `bun run check:job` passes (its last line in the final message).
- The final message lists the total spend.
