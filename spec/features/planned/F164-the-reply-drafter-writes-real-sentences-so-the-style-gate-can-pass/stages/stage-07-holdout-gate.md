# F164 stage 05 — Holdout gate and production pointer `[risky]`

Needs stage 04: the final `drafter-v5.ts` and the verdict line of `tuning-1.md`. With `Verdict: stop`, this stage runs only step 4 (no spend, no key), so the ticket still closes with its record.
The coordinator starts this job with the OpenAI key in the job environment; the worker never reads, prints or stores it. Spend cap: $0.60 in the ledger (P3).
Part of [`../plan.md`](../plan.md). Decisions: P2, D7, D9, D10. Rules for every stage apply.

## Step 1 — holdout run, once

- **Goal:** the gate file of drafter-v5 (only with `Verdict: go on`).
- **Command:** `bun run eval --sim lab-01 --part holdout --drafter --judge --model gpt-6-luna --reasoning-effort low --drafter-prompt drafter-v5 --concurrency 2 --rpm 30 --judge-rpm 30 --budget-usd <rest of the cap, at most 0.55> --out evals/results/<date>-sim-lab-01-holdout-gpt-6-luna-drafter-v5-reply-judge-terra-judge-v3.md` (about $0.45, F115 `tuning-4.md`). No `--limit`, no `--style` (scenario), no dump (the tool refuses one for holdout).
- **Decisions:** `drafter-v5.ts` does not change before or during this run (D9). A killed run resumes with the same command; it is still one use. Open only the report and `evals/results/gate/drafter-drafter-v5-gpt-6-luna-low-lab-01-v1.json`.
- **Done when:** the gate file exists, with `passed` true or false.

## Step 2 — injection set

- **Command:** `bun run eval --set reply-injection --drafter --judge --model gpt-6-luna --reasoning-effort low --drafter-prompt drafter-v5 --concurrency 2 --rpm 30 --judge-rpm 30 --budget-usd <rest> --out evals/results/<date>-reply-injection-gpt-6-luna-drafter-v5-reply-judge-terra-judge-v3.md` (about $0.02). Bar: 14 of 14.
- Run it also when step 1 failed: the report is the record.

## Step 3 — the pointer, only under P2

- **When** the gate file says `"passed": true`, the injection set passed 14 of 14, and `tuning-1.md` shows traps 10 of 10 with 0 invented commitments: set `prompts.drafter` to `drafterVersions["drafter-v5"]` and change the pointer test in `replies/drafter.test.ts` to `"drafter-v5"`.
- **Else:** the pointer stays `drafter-v4`; no code change; step 4 says which bar failed. No drafter-v6 in this ticket (D9).
- **Test:** the pointer test (`prompts.drafter.version` is `"drafter-v5"` when switched); the existing drafter tests pass unchanged (the job tests use a fake model, so no other test should move; a test that does is a question, not a fix).
- **Check:** `bun test apps/server/src/modules/replies/drafter.test.ts`.

## Step 4 — records

- `tuning-2.md` in this ticket folder: the holdout row (cases, drafts, `needs_facts`, code checks, invented commitments, send as is, planted leaks, cost, report and gate file paths, `passed`), the injection row, the "Sentences" block of the holdout report (shares only), the ledger lines and the ticket total, and the pointer result.
- `docs/capabilities/reply-drafts.md`: when switched, rule 4 describes drafter-v5 (the five sentence kinds of D1, instruction facts as full sentences) and the date; the Limits "holdout gate" bullet names the v5 report and gate file; the Limits "Style" bullet names the F122 `tuning-2.md` smoke result. When not switched (or after `Verdict: stop`), only the two Limits bullets change, naming the failed bar and `tuning-1.md`. Update the "Checked against" line.
- `apps/server/src/modules/replies/capability-page.test.ts` passes (it checks the page against the code).

## Done when (stage)

Gate file, both reports, `tuning-2.md`, the capability page and (under P2) the pointer are committed. Proof: the last line of `bun run check:job`.

## Out of scope

A new prompt version, the judge, the style holdout runs and `eval:style-gate` without `--smoke` (P4), turning on `reply_drafts` or `style_from_sent`, a release.
