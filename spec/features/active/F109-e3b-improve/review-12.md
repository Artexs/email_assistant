# F109 stage 12 review (Sonnet 5.5, PASS 42e8f73b)

Model: Sonnet 5.5, because no production path is switched on (eval and pure core only). No BLOCKING, no TEST GAP.

Notes:
1. Price source of `gpt-6.1-terra` ($1.00 / $0.05 / $5.00 per 1M, `checked: "2026-11-15"`) was not re-read by the reviewer. The worker read the OpenAI page; accepted.
2. `cachedInputPerM` is ignored by `costPerMail`: costs are an upper bound (report says so).
3. The `m7.test.ts` change (unpriced model now `gpt-6.1-sol`) is legitimate.
4. The comment in `prompts/escalation-v1.ts` says "the registry test checks it": the check is in `eval-escalation.test.ts`. Fix the comment when the file is next edited.
5. `shouldEscalate` has no whitelist rule (the stage lists none): whitelisted `info` or `notification` mail from a person can escalate. Rule-spam never escalates.
6. One new lint warning (`log.warn` for an escalation failure in `eval.ts`), same style as the existing eval warnings. Stage 13 or F103 converts it.
7. The second call always uses the `classifier-v2` text. A run with `--prompt-version classifier-v3 --escalate` would mix v3 first answers with v2 second answers: see the carry-over in stage 13.
8. `--escalate` is refused on an own endpoint (no USD cap).
