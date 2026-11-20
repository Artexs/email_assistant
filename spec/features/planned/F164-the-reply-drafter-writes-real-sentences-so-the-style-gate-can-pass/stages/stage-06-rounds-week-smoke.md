# F164 stage 06 — Dev rounds 2–3, week run and the style smoke `[risky]`

Needs stage 05: `drafter-v5.ts` and the `Round 1:` line of `tuning-1.md`. Needs stage 04: `eval:style-gate --smoke`.
The coordinator starts this job with the OpenAI key in the job environment; the worker never reads, prints or stores it. Spend cap: $0.90 (P3).
Part of [`../plan.md`](../plan.md). Decisions: P2, P4, D5–D8, D11.

## Step 1 — rounds 2 and 3, only when needed

- `Round 1: pass` → skip to step 2.
- Else change `drafter-v5.ts` only for what the round 1 read list and reports show, commit, and run the three runs of stage 05 step 2 as round 2 (`-r2`, each first start with `--fresh`). Same bars, same read. Round 2 fails → round 3 the same way. Round 3 fails → verdict `stop`.
- The text never changes after the round that passes.

## Step 2 — week run, once

The passing text: `--sim lab-01 --part week --drafter --judge --fresh`, estimate $0.30. Bars: all code checks, 0 invented commitments, send as is ≥ 0.85, skeleton ≤ 20 %, every `leaning ids` entry read and judged a false match. A miss → verdict `stop` (no fourth round).

## Step 3 — the style smoke, once, on the final text

- Two runs (D6), estimate $0.12 together: `--sim lab-01 --part dev --drafter --judge --judge-prompt judge-v4 --limit 20 --fresh`, A with `--style none`, B with `--style evals/results/styles/lab-01-sent-holdout-stylist-v1-gpt-6-luna-low.json`. Then `bun run eval:style-gate --smoke --a <A state> --b <B state> --style <B file> --out evals/results/<date>-style-smoke-drafter-v5.md`.
- It runs also after a `stop` verdict, when the stop came from a safety bar and not from spend or a 429: the smoke measures v5's room for style either way.
- The smoke is not a tuning input (P2): no prompt change after it.

## Step 4 — records

- `tuning-1.md`: the rows of rounds 2–3 and week (as in stage 05), the smoke line, the ledger lines and the ticket total so far, and a last line `Verdict: go on` or `Verdict: stop — <bar>`.
- `spec/features/done/2026-11/F122-e6b-style-from-sent/tuning-2.md`: the v5 smoke against F122 run 4 (means, wins / losses / ties, verdict, report path). It also says, in plain words: the 20 cases were seen in dev tuning; judge-v4 scores `style_match` "as far as the draft rules allow … and the reply is short", and no style already scores 1.85 of 2, so the room for a gain is small; a `pass (smoke)` is a screen for the holdout style gate, not proof that the style works. When `fail` or `judge stop`, why, read in the 20 paired dumps.
- Commit both with the reports; dumps stay outside git.

## Test

No new code. The checks are the run bars above; the proof runs the existing suites of the changed files.

## Stop

As stage 05: an HTTP 429, a judge error share above 5 % or the spend rule of `plan.md` → stop, write it, ask.

## Done when (stage)

Steps 1–4 done; `tuning-1.md` ends with the verdict line. Proof: the last line of `bun run check:job`.

## Out of scope

Holdout, injection, pointer (stage 07); judge, stylist, flags.
