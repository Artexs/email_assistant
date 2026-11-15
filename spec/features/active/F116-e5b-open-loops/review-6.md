# F116 stage 06 review (Opus 5.5, PASS da4b1942)

Model: Opus 5.5, because the stage is [risky]: LLM eval with real money and a change (oneOf -> anyOf) in the shared OpenAI strict-schema code. No BLOCKING.

Fixed in one Sonnet continue (no re-review): TG1 (a holdout failure line printing `result.id` passed all tests: a holdout id would reach the run log; the committed report is safe).

Verified: the gate numbers recompute from the counts (expects_reply tp125 fp1 fn0 tn124; promise tp63 fp1; due 38/38; injection 6 cases, 0 leaks). Wilson lower bounds: recall 0.9702, precision 0.9564, promise precision 0.9167 (bar 0.90: small margin), due 1.0; they match the gate file. The strict-schema change alters only `oneOf` nodes: every other role schema (classifier, escalation, judge, llm-check) is byte-identical (probe). Spend: three ledger lines ($0 failed schema try, $0.0061831 dev, $0.0309696 holdout; total $0.0371527), all under the $1 budget; one holdout run; the prompt and extractor code unchanged since stage 05 (no tuning). No holdout slot id in the committed holdout report or gate file. Runner rules (skip = no reply, error cases rerun on resume, over 10% errors exits 1, budget exit 2, usage error) hold. 21 worker mutations killed.

Notes for stage 12 and later:
- Gemini: `gemini.ts` sends the raw Zod JSON schema (with `oneOf`) as `responseJsonSchema`; the anyOf rewrite is OpenAI only. Stage 12 must check that Gemini accepts the extractor schema before the extractor runs on a Gemini install.
- Gate file name: `gateFileName` writes `...-lab-01-vsent-v1.json` (a `v` before `sent-v1`); the stage text says `sent-v1`. The evidence test finds the file by the prefix `extractor-<promptVersion>-` and re-checks endpoint, passed and numbers; stage 12 depends only on that test. Correct the stage text or leave it.
- `extractorGateEvidence` does not read `errors`: up to 10% error cases (scored as empty answers) could still give a passing gate. This run had 0. Stage 12 could require errors = 0 for the evidence.
- Scoring asymmetry: the label side uses `promise = labels.promise !== null`, the prediction side needs a resolved date: an undated label promise would count as fn for a correct answer. On the holdout promise positives equal dated labels (63), so the numbers are not affected.
- `holdsPlanted` finds only copies (at least 12 characters), not paraphrases or translations: "leak 0" means no copied string.
- The stage Check command does not run `modules/loops` (the evidence test and T1-T3, T6 live there); `test:unit:ci` runs them.
