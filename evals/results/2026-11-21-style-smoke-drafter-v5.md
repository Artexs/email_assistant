# Style smoke

- Run A (no style): gpt-6-luna-low-drafter-v5-drafter-sim-lab-01-v1-dev-style-none-judge-gpt-6.1-terra-judge-v4.jsonl
- Run B (style): gpt-6-luna-low-drafter-v5-drafter-sim-lab-01-v1-dev-style-stylist-v1-c25598cf-judge-gpt-6.1-terra-judge-v4.jsonl
- Drafter prompt: drafter-v5
- Style file: evals/results/styles/lab-01-sent-holdout-stylist-v1-gpt-6-luna-low.json
- The cases are the ones the drafter prompt was tuned on: this is a smoke, not a gate, and no gate file is written.

Pairs: 20 (wins 3, losses 3, ties 14)
style_match mean: A 1.75, B 1.75
Judge error share: A 0.0%, B 0.0%
Verdict: fail (smoke)

## Pairs (style_match of A, then B)

- b-rep-0002: 2, 1
- b-rep-0018: 2, 2
- b-rep-0021: 1, 2
- b-rep-0028: 2, 2
- b-rep-0030: 2, 2
- b-rep-0036: 2, 2
- b-rep-0037: 2, 2
- b-rep-0042: 1, 2
- b-rep-0044: 2, 2
- b-rep-0045: 1, 1
- b-rep-0071: 1, 1
- b-rep-0074: 2, 1
- b-rep-0083: 2, 2
- b-rep-0085: 2, 1
- b-rep-0089: 1, 2
- b-rep-0095: 2, 2
- b-rep-0108: 2, 2
- b-rep-0110: 2, 2
- b-rep-0113: 2, 2
- b-rep-0126: 2, 2