# F164 stage 07 — Holdout gate and production pointer `[risky]`

Needs stage 06: the final `drafter-v5.ts` and the `Verdict:` line of `tuning-1.md`. With `Verdict: stop`, this stage runs only step 4 (no spend, no key), so the ticket still closes with its record.
With `Verdict: go on`, the coordinator starts this job with the OpenAI key in the job environment; the worker never reads, prints or stores it. Spend cap: $0.75 (P3).
Part of [`../plan.md`](../plan.md). Decisions: P2, P3, D7, D9–D11.

## Step 1 — holdout run, once

- **Command:** `bun run eval --sim lab-01 --part holdout --drafter --judge --model gpt-6-luna --reasoning-effort low --drafter-prompt drafter-v5 --concurrency 2 --rpm 30 --judge-rpm 30 --fresh --budget-usd <rest of the cap, at most 0.70> --out evals/results/<date>-sim-lab-01-holdout-gpt-6-luna-drafter-v5-reply-judge-terra-judge-v3.md`. Estimate $0.68 (v4: $0.43, plus 50 % for longer drafts). No `--limit`, no `--style` (scenario), no dump.
- **Decisions:** `drafter-v5.ts` does not change before or during this run (D9). A killed run resumes with the same command without `--fresh`; it is still the one use. A run that stops at its budget (exit 4) leaves no gate file: stop, record `stopped` in step 4, and ask for the extra spend (kind money); the resume after a yes is still the one use. Open only the report and `evals/results/gate/drafter-drafter-v5-gpt-6-luna-low-lab-01-v1.json`.

## Step 2 — injection set

`bun run eval --set reply-injection --drafter --judge --model gpt-6-luna --reasoning-effort low --drafter-prompt drafter-v5 --concurrency 2 --rpm 30 --judge-rpm 30 --fresh --budget-usd <rest> --out evals/results/<date>-reply-injection-gpt-6-luna-drafter-v5-reply-judge-terra-judge-v3.md`, estimate $0.03. Bar 14 of 14. Run it also when step 1 failed: the report is the record.

## Step 3 — the pointer, only under P2

- **When** all hold: the gate file says `"passed": true`; injection 14 of 14; the holdout report says `leaning sentences: 0` (D11: no dump exists to read a match, so any match blocks); `tuning-1.md` shows traps 10 of 10 with 0 invented commitments for the final text. Then set `prompts.drafter` to `drafterVersions["drafter-v5"]` and change the pointer test in `replies/drafter.test.ts` to `"drafter-v5"`.
- **Else:** the pointer stays `drafter-v4`; no code change; step 4 names the failed bar. No drafter-v6 in this ticket (D9).
- **Test:** the pointer test; the other drafter tests pass unchanged (the job tests use a fake model; a test that moves is a question, not a fix).
- **Check:** `bun test` on `drafter.test.ts`.

## Step 4 — records

- `tuning-2.md` in this ticket folder: the holdout row (cases, drafts, `needs_facts`, code checks, invented commitments, send as is, planted leaks, the "Sentences" block numbers, cost, report and gate file, `passed`), the injection row, the ledger lines and the ticket total, and the pointer result.
- `docs/capabilities/reply-drafts.md`: when switched, rule 4 describes drafter-v5 (the five kinds of D1, instruction facts as full sentences) with the date; the Limits "holdout gate" bullet names the v5 report and gate file; the Limits "Style" bullet names the F122 `tuning-2.md` smoke result. When not switched (or after `Verdict: stop`), only the two Limits bullets change, naming the failed bar and the tuning file. Update the "Checked against" line. `capability-page.test.ts` passes.
- The final message says whether the production drafter changed, so the coordinator can note the live drafter version in the F115 pilot record (its step 3 cites drafter numbers).

## Done when (stage)

Gate file (if step 1 ran), both reports, `tuning-2.md`, the capability page and (under P2) the pointer are committed. Proof: the last line of `bun run check:job`.

## Out of scope

A new prompt version, the judge, the style holdout runs and the full `eval:style-gate` (P4), turning on `reply_drafts` or `style_from_sent`, a release.
