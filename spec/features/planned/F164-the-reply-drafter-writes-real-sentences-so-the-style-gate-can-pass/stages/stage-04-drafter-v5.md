# F164 stage 04 — drafter-v5 and dev tuning `[risky]`

Needs stage 01: the "Sentences" report block. Needs stage 02: `--set reply-facts`, `factsVerdict`. Needs stage 03: `eval:style-gate --smoke`.
The coordinator starts this job with the OpenAI key in the job environment; the worker never reads, prints or stores it. Spend cap: $1.10 (P3).
Part of [`../plan.md`](../plan.md). Decisions: P1–P4, D1, D5–D8.

## Step 1 — the prompt file

- **Files:** a new `triage/prompts/drafter-v5.ts`; the `drafterVersions` registry; `replies/drafter.test.ts`.
- **Interface:** `drafterVersions["drafter-v5"]`, `PROMPT_VERSION = "drafter-v5"`, the drafter-v1 user prompt, a new system text. `prompts.drafter` stays `drafter-v4` (stage 05 moves it).
- **Decisions:** D1: every drafter-v4 line outside its section "Sentences outside a gap" stays; that section becomes the five kinds of D1, with correct and wrong examples in both languages and the re-read rule over the five kinds. The style shapes wording, length, opening and closing within the kinds. Examples are generic: no corpus mail, address or draft.
- **Test (`drafter.test.ts`):**
  1. Every line of the drafter-v4 system text outside its "Sentences outside a gap" section is a line of the drafter-v5 text.
  2. drafter-v5 holds neither v4 line that starts "Only these sentences may stand outside a gap" or "Before you return the JSON, read every sentence outside a gap again".
  3. The registry `test.each` over versions includes v5 (own id, user builder is v1's, text differs from v4).
  4. `prompts.drafter.version` is still `"drafter-v4"`.
- **Check:** `bun test` on `drafter.test.ts`.

## Step 2 — dev rounds (at most 3)

One round = these runs on one committed text, each with `--drafter-prompt drafter-v5 --model gpt-6-luna --reasoning-effort low`, the run flags of the rules, a dump under `/tmp/f164/dumps/`, reports named `…-drafter-v5-…-r<n>.md` (D8):

| run | flags | cost |
| --- | --- | --- |
| dev | `--sim lab-01 --part dev --drafter --judge` (judge-v3) | $0.14 |
| traps | `--set reply-commitment --drafter --judge` | $0.02 |
| facts | `--set reply-facts --drafter` | about $0.02 |
| smoke A | `--sim lab-01 --part dev --drafter --judge --judge-prompt judge-v4 --limit 20 --style none` | $0.04 |
| smoke B | the same with `--style evals/results/styles/lab-01-sent-holdout-stylist-v1-gpt-6-luna-low.json` | $0.04 |

Then `bun run eval:style-gate --smoke --a <A state> --b <B state> --style <B file> --out evals/results/<date>-style-smoke-drafter-v5-r<n>.md`.

- **Read:** every sentence outside a gap in the dev, traps and facts dumps; list each that leans toward a commitment, restated term or later action (F115 `tuning-2.md`), with its id.
- **Go-on bars (all in one round):**
  1. dev: code checks on every draft; 0 invented commitments; 0 judge errors; send as is or small edit ≥ 0.86 of the drafts (drafter-v4: 73 of 80, 0.91, minus 5 points of noise); `needs_facts` share ≤ 0.05.
  2. dev: skeleton drafts (stage 01 block) ≤ 20 % of the drafts.
  3. traps: 10 of 10 code checks and 0 invented commitments.
  4. facts: `factsVerdict` passed (12 of 12).
  5. No leaning sentence left in the list above.
  The smoke verdict is recorded, no go-on bar (P2); the report says its 20 cases were seen in tuning.
- **Stop:** three rounds without all bars, a judge stop, an HTTP 429 or the cap → verdict `stop`; stage 05 does not run.

## Step 3 — week run, once

Passing text, `--sim lab-01 --part week --drafter --judge`, about $0.20. Bars: all code checks, 0 invented commitments, send as is ≥ 0.85, skeleton ≤ 20 %. A miss → `stop`.

## Step 4 — the two result files

- `tuning-1.md` in this ticket folder: a row per run (round, `drafter-v5.ts` commit, cases, code checks, invented commitments, send as is, skeleton share, cost, report), the leaning sentences per round, the ledger lines and total, and a last line `Verdict: go on` or `Verdict: stop — <bar>`.
- `spec/features/done/2026-11/F122-e6b-style-from-sent/tuning-2.md`: the smoke of the final round against F122 run 4 (means, wins / losses / ties, verdict, report path); when `fail` or `judge stop`, why, read in the 20 paired dumps.
- Commit both with the reports; dumps stay outside git.

## Done when (stage)

Steps 1–4 done. Proof: the last line of `bun run check:job`.

## Out of scope

The holdout, injection set, pointer, judge, stylist, flags.
