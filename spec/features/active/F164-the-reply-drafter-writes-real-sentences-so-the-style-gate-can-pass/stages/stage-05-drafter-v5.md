# F164 stage 05 — drafter-v5 and dev round 1 `[risky]`

Needs stage 02: the "Sentences" block and the `sentences` field. Needs stage 03: `--set reply-facts`, `factsVerdict`.
The coordinator starts this job with the OpenAI key in the job environment; the worker never reads, prints or stores it. Spend cap: $0.35 (P3).
Part of [`../plan.md`](../plan.md). Decisions: P1, P3, D1, D2, D7, D8, D11.

## Step 1 — the prompt file

- **Files:** a new `triage/prompts/drafter-v5.ts`; the `drafterVersions` registry; `replies/drafter.test.ts`.
- **Interface:** `drafterVersions["drafter-v5"]`, `PROMPT_VERSION = "drafter-v5"`, the drafter-v1 user prompt, a new system text. `prompts.drafter` stays `drafter-v4` (stage 07 moves it).
- **Decisions (D1):** every drafter-v4 line outside its section "Sentences outside a gap" stays word for word; that section becomes the five kinds of D1, with correct and wrong examples in both languages and the re-read rule over the five kinds. Kind 4 keeps the words of the line for each fact (day, time, amount, name, yes or no) and adds only grammar words. Kinds 2 and 5 are optional; the prompt never asks for them to fill a draft. The style shapes wording, length, opening and closing within the kinds. Examples are generic (no corpus mail).
- **Test (`drafter.test.ts`):**
  1. Every line of the drafter-v4 system text outside its "Sentences outside a gap" section is a line of drafter-v5.
  2. drafter-v5 holds neither v4 line that starts "Only these sentences may stand outside a gap" or "Before you return the JSON, read every sentence outside a gap again".
  3. The registry `test.each` over versions includes v5 (own id, user builder is v1's, text differs from v4).
  4. `prompts.drafter.version` is still `"drafter-v4"`.
- **Check:** `bun test` on `drafter.test.ts`.

## Step 2 — dev round 1

Each run: `--drafter-prompt drafter-v5 --model gpt-6-luna --reasoning-effort low`, the run flags of the rules, `--fresh`, a dump under `/tmp/f164/dumps/`, a report named `…-drafter-v5-…-r1.md` (D8).

| run | flags | estimate |
| --- | --- | --- |
| dev | `--sim lab-01 --part dev --drafter --judge` (judge-v3) | $0.21 |
| traps | `--set reply-commitment --drafter --judge` | $0.03 |
| facts | `--set reply-facts --drafter` | $0.03 |

- **`--fresh` (B1 of the review):** the state file name has no hash of the prompt text, so a run without `--fresh` reuses the results of an older text. Every first start of a round's run uses `--fresh`. A killed run resumes with the same command **without** `--fresh`, and writes its dump to a new file (`…-b.jsonl`): resumed results have no text.
- **Read:** every sentence outside a gap in the three dumps. List each that leans toward a commitment, a restated term or a later action (F115 `tuning-2.md` shapes), with its id. For each id in the report's `leaning ids`, write whether it is a real lean or a false match.
- **Round bars (D2, D11; stage 06 uses the same):**
  1. dev: code checks on every draft; 0 invented commitments; 0 judge errors; send as is or small edit ≥ 0.86 of the drafts (drafter-v4: 73 of 80, 0.91, minus 5 points of noise); `needs_facts` share ≤ 0.05.
  2. dev: skeleton drafts ≤ 20 % (met by kind 3 wording, not by filler of kinds 2 and 5).
  3. dev and traps: every `leaning ids` entry read and judged a false match.
  4. traps: 10 of 10 code checks, 0 invented commitments.
  5. facts: `factsVerdict` passed (12 of 12).
  6. The read list holds no real lean.

## Step 3 — `tuning-1.md` in this ticket folder

A row per run (round, `drafter-v5.ts` commit, cases, code checks, invented commitments, send as is, skeleton share, leaning count, cost, report path), the read list with ids, the ledger lines, and a line `Round 1: pass` or `Round 1: fail — <bars>`. Commit the reports and `tuning-1.md`; dumps stay outside git.

## Stop

An HTTP 429, a judge error share above 5 % or the spend rule of `plan.md` → stop, write the reason in `tuning-1.md`, and ask in the final message.

## Done when (stage)

Steps 1–3 done. Proof: the last line of `bun run check:job`.

## Out of scope

Rounds 2–3, week, smoke (stage 06); holdout, injection, pointer (stage 07); judge, stylist, flags.
