# Stage 03 stopped before run 1: the spend ledger has less room than the plan needs

The stage rule: before run 1, the month total of the spend ledger must leave room for $14 under the $20 month cap; else stop and ask.

Observed on 2026-11-25 (UTC):

- Ledger: `~/.local/state/email-assistant/eval-spend.jsonl` (the default path of `defaultLedgerPath`).
- Month 2026-11 total (`monthSpend` of `apps/server/src/platform/eval-ledger.ts`): $7.53.
- Room under the $20 cap: $12.47. The plan needs $14 (four runs, caps $2 + $2 + $1 + $2, one resume each at the same cap).
- No DeepSeek call ran. Spend of this job: $0.

Cost of the same runs on OpenAI this month (from the ledger, per run): classifier holdout about $0.28, drafter holdout with judge about $0.47, reply injection set about $0.02, extractor sent-holdout $0.03; together about $0.80. The DeepSeek runs will likely cost well under the first-pass caps ($7). Only a run that stops at its cap and resumes can need more room. This estimate is a guess from OpenAI costs, not a DeepSeek measurement.

The eval tool enforces the $20 month cap by itself (`runCap`): a run never gets a cap above the room that is left. So the month cap holds in every option.

## Question

May the gate runs start with $12.47 of room?

1. **Run now with the plan caps (recommended).** The first passes need at most $7. A resume gets at most the room that is left; when the tool cuts a resume to less than its plan cap and it stops again, the summary row says "not run" with the month-cap reason. Total spend stays at most $12.47 this month.
2. Run now with smaller caps that fit $12.47 in the worst case (for example $1.5, $1.5, $1, $1.5, one resume each: $11). Changes the plan caps.
3. Wait for 2026-12-01 (UTC), when the month total starts at $0, and run the plan unchanged.

Default if no answer: option 3 (no spend without the owner's word, the styleguide rule for real money).
