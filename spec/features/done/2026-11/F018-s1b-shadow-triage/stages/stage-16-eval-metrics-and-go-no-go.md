# s1b-shadow-triage — Stage 16

Part of [`../plan.md`](../plan.md). Read that file's "Input" and "Rules for every step" first.

## Stage 16 — Eval metrics and go/no-go [risky]

- [x] **16.1 Pure metrics, threshold sweep, go/no-go with minimum support, histogram and cost**
  - Goal: pure functions that turn predictions into precision, recall, thresholds, a go/no-go decision, a confidence histogram and a cost per mail.
  - Files: create `packages/core/src/triage/metrics.ts`, `packages/core/src/triage/cost.ts` and their `*.test.ts`; export from the triage index.
  - Interfaces:
    - `interface Prediction { expected: Category | null; predicted: Category; modelCategory: Category; confidence: number; source: "llm" | "rule" | "error"; wrongOnly?: boolean }` (`wrongOnly` = feedback said "wrong" with no true category; `source`: `llm` = an LLM answer, `rule` = blocklist result with no LLM call, `error` = `triage_error` after 3 hard errors). A response that Google blocked (`llm_blocked`, user answer Q28) is an `llm` row with `predicted` and `modelCategory` `unsure` and `confidence` 0: a miss for the recall of its expected category, no false positive, and never in a sweep (its `modelCategory` is not one of the 5 bar categories).
    - `computeMetrics(rows: Prediction[]): Record<Category, { tp: number; fp: number; fn: number; support: number; precision: number | null; recall: number | null }>`.
    - `confusionMatrix(rows): Record<Category, Record<Category, number>>`.
    - `THRESHOLDS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]`.
    - `thresholdSweep(rows, category, thresholds = THRESHOLDS): { threshold: number; precision: number | null; recall: number | null; kept: number }[]`.
    - `goNoGo(rows, opts?: { bar?: number; minKept?: number }): Record<"urgent" | "needs_reply" | "info" | "notification" | "spam", { threshold: number | null; precision: number | null; recall: number | null; kept: number; decision: "go" | "no-go" | "no-go: too few" }>`.
    - `ruleSummary(rows): { rule: { total: number; right: number; wrong: number }; error: { total: number } }`.
    - `confidenceHistogram(rows, category): { bucket: string; total: number; correct: number }[]`.
    - `llmPrices: Record<string, { inputPerM: number; outputPerM: number; from?: string; source: string; checked: string }[]>` and `costPerMail(model, tokensIn, tokensOut, at: Date): number | null`; `monthlyCost(avgCostPerMail, mailsPerDay): number` (× 30).
  - Decisions:
    - Only `source: "llm"` rows count in `computeMetrics`, `confusionMatrix`, `thresholdSweep`, `goNoGo` and `confidenceHistogram`. Blocklist rule rows (model NULL, confidence 1) would raise the LLM spam precision, and error rows have no model answer (review finding 18). `ruleSummary` reports them on a separate line: rule `right` = `expected === predicted`; rule `wrong` = `wrongOnly`, or `expected` known and different.
    - Precision of category C = tp / (tp + fp) over rows predicted C; recall = tp / (tp + fn) over rows expected C. A `wrongOnly` row counts only as a false positive for its predicted category (architecture §4.4). A row predicted `unsure` (below the threshold) is a miss for recall and no false positive. `unsure` and `delegation` get no bar (architecture §4.2).
    - Sweep: a row counts for C at threshold t when `modelCategory === C` and `confidence >= t` and its truth is known (`expected` not null, or `wrongOnly`). `kept` = the number of such rows. tp = `expected === C`; fp = the rest. `recall` at t = tp ÷ (LLM rows with `expected === C`).
    - Go/no-go (user answer 2, 2026-11-04; review finding 6): `bar` default 0.98, `minKept` default 30 (the user may change both). Eligible thresholds = those with `kept >= minKept`. No eligible threshold → `"no-go: too few"`, `threshold: null`, and `kept`, `precision`, `recall` from the lowest threshold (0.5). Else the lowest eligible threshold with `precision >= bar` → `"go"` with its threshold, precision, recall and kept. Else `"no-go"`, `threshold: null`, with the values of the lowest eligible threshold.
    - Histogram (main-session decision, review finding 28): LLM rows with `modelCategory === C`; buckets `0.00–0.49`, `0.50–0.59`, `0.60–0.69`, `0.70–0.79`, `0.80–0.89`, `0.90–0.94`, `0.95–1.00` (lower bound in, upper bound out, except 1.00 is in the last bucket); `correct` = rows with `expected === C`.
    - Prices from ADR 0012: `gemini-3.8-flash` $0.75 input / $3.75 output per 1M tokens until 2026-12-31, then $1.50 / $7.50. Flash-Lite prices: take them from https://ai.google.dev/gemini-api/docs/pricing when you build the step, and put the URL and the date in `source` / `checked` [not verified]. An unknown model → `null` (the report shows "no price").
    - Default load for the monthly figure: 200 mails per day per mailbox (architecture §1, ADR 0012).
    - The cost figures use the paid-tier price even while the pilot runs on the free tier (user answer 3, 2026-11-04): they show what the mailbox costs when billing is on. Every price row names its source URL and the date it was read; the report prints them.
  - Test: hand-made rows with known tp/fp/fn; `wrongOnly` rows; empty category → `null` precision; rule rows (blocklist, spam, confidence 1) change neither the spam precision nor the sweep, and `ruleSummary` counts them; error rows are left out and counted; a blocked row (`source: "llm"`, predicted and model category `unsure`, confidence 0, expected `spam`) lowers the spam recall and changes no precision; go/no-go: 29 kept rows at 0.5, all right → `"no-go: too few"`; 30 kept rows, all right → `"go"` at 0.5; 40 rows where precision ≥ 0.98 only at 0.9 with 12 kept rows (0.9 not eligible) → `"no-go"`; a set where 0.8 is the first eligible threshold with precision ≥ 0.98 → `"go"` at 0.8; `minKept: 1` gives the old behaviour on the same set; histogram edges 0.495 → `0.00–0.49`, 0.5 → `0.50–0.59`, 0.95 and 1.0 → `0.95–1.00`; price switch on 2027-01-01; unknown model.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: the tests pass.
  - Out of scope: reading files, the DB or the network.
