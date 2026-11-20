# F122 · Tuning 2 (style smoke with drafter-v5)

Verdict: **`fail (smoke)`.** With the reply drafter that writes a full sentence around each gap (drafter-v5, tuned in `spec/features/active/F164-the-reply-drafter-writes-real-sentences-so-the-style-gate-can-pass/tuning-1.md`), drafts with the suggested style (B) got the same mean `style_match` as drafts with no style (A): 1.75 against 1.75, with 3 wins, 3 losses and 14 ties. Report: `evals/results/2026-11-21-style-smoke-drafter-v5.md`.

## Against run 4 of this ticket (drafter-v4)

| run | drafter | `style_match` mean A | mean B | wins / losses / ties of B | send as is A / B | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 4 (`tuning-1.md`) | drafter-v4 | 1.85 | 1.85 | 1 / 1 / 18 | 17 / 16 of 20 | `fail (smoke)` |
| v5 smoke | drafter-v5 at commit `e71dcd95a` | 1.75 | 1.75 | 3 / 3 / 14 | 16 / 18 of 20 | `fail (smoke)` |

Same sample and style as run 4: `--sim lab-01 --part dev --drafter --judge --judge-prompt judge-v4 --limit 20 --fresh`, A `--style none`, B `--style evals/results/styles/lab-01-sent-holdout-stylist-v1-gpt-6-luna-low.json`, model `gpt-6-luna` low, judge `gpt-6.1-terra`. Judge errors 0 of 20 in each run; `style_match` takes the values 1 and 2, so the judge stop does not apply. Run reports:

- A: `evals/results/2026-11-21-sim-lab-01-dev-smoke20-gpt-6-luna-drafter-v5-judge-v4-style-none.md` ($0.0407)
- B: `evals/results/2026-11-21-sim-lab-01-dev-smoke20-gpt-6-luna-drafter-v5-judge-v4-style-sent-holdout-stylist-v1.md` ($0.0414)

## What the result can and cannot say

- The 20 cases are dev cases: the drafter-v5 prompt was tuned on them.
- judge-v4 scores `style_match` "as far as the draft rules allow … and the reply is short". With no style, A already scores 1.75 of 2 here (1.85 with drafter-v4). The room for a gain is small.
- A `pass (smoke)` would only be a screen for the holdout style gate. It would not prove that the style works. This result is a `fail`.

## Why it failed (read in the 20 paired dumps)

drafter-v5 still writes one fixed line per question. Nearly every A and B draft is a greeting plus "Co do <topic>, moja odpowiedź to [[…]]." or "On <topic>, my answer is [[…]]." / "The answer to your question about <topic> is [[…]]." No draft of either run has an opening, a closing or a prose sentence. A and B differ only in the topic words, the gap labels, one gap or two for a question, and in one pair the greeting ("Hi Oliver" for "Oliver"). The style text has no place to show.

The 6 decided pairs follow those differences, not the style:

- B wins: b-rep-0021 and b-rep-0042 (B names the topic more fully, or holds two parts in one gap), b-rep-0089 (the A and B drafts are the same text, scored 1 and 2: judge noise).
- B loses: b-rep-0002 (B adds a gap on the whole budget), b-rep-0074 (a different split of the gaps), b-rep-0085 (a shorter gap label).

b-rep-0126 is also the same text in A and B (a tie at 2). So at least one of the six decided pairs is judge noise on equal text.

The next step for style from sent mail stays as in run 4: a drafter whose sentences can carry the style (a new ticket). The flag `style_from_sent` stays off.
