# F110 stage 07 — History check: sample, classify, result `[risky]`

Part of [`../plan.md`](../plan.md). Risk: LLM spend, LLM prompt use on real mail, exactly-once.

## Step 1 — Sample and classify

- **Goal:** `classifying` writes one `history_check_items` row per sample mail (D10, D11, D12).
- **Files:** `trust/history-classify.ts`; a triage export that classifies one stored mail without saving a triage result (name it `classifyStored`, in `triage/index.ts`): the hard rules, the thread context, `classifyEmail`, `decideCategory` with the mailbox thresholds, and the would-do plan (`planActions` + `decidePolicy` as if the mode were `assist` with `ASSIST_DEFAULT_SWITCHES` and `categoryAuto` true). It returns `{ category, confidence, reasonCode, wouldMove: boolean, usage | null, source: "rule" | "classified" }`.
- **Decisions:**
  - Sample (D11): mail of the mailbox with `received_at >= window_start`, a body not cleared, not own mail, following `TRIAGE_LLM_SCOPE` (`synthetic` → test mail only, as the triage claim). Acted-on first (D6: `email_flags.answered` or `flagged`, or a feedback row with true category `urgent`/`needs_reply`), newest first; then the rest in an order seeded by the check id (`md5(check_id || email_id)`), to 500.
  - A mail with a `triage_results` row reuses its newest row (`source: triage_result`, no call); `wouldMove` comes from its planned move action.
  - Batches of 5 per run; each item commits alone with its `cost_usd` (`costPerMail(model, tokensIn, tokensOut, at, endpoint)`); `history_checks.cost_usd` = the sum, in the same transaction.
  - Before each call: cost so far ≥ $0.25 → stop sampling, `capped = true`, go to Step 2. Unpriced model (no price row for the endpoint) → `no_result` / `cost_unknown` before any call (Q5).
  - Each call writes its `llm.call` audit row with `data.historyCheckId`; the daily-cap count in `triage/jobs.ts` leaves those rows out. The LLM pause of the process applies: during a pause the step reschedules to the pause end, no attempt.
  - A soft or config LLM error: like the pause. A hard error on one mail: skip that mail (no item), go on.
- **Test** (`apps/server/test/integration/trust-history-classify.test.ts`, fake LLM client with fixed usage and a fixture price):
  1. 60 window mails, 10 acted-on, 1 already triaged → the first batch holds the acted-on mails; the triaged one makes no call.
  2. Price per call $0.01 → the check stops at 25 calls, `capped` true, `cost_usd` 0.25.
  3. A crash after a call and before its commit (test hook) → on repeat one more call for that mail, still one item row.
  4. An unpriced model → `no_result` / `cost_unknown`, zero calls.
  5. 300 normal `llm.call` rows today plus 50 history rows → the triage cap still lets the worker run (the cap counts 300 only at the next normal call).
  6. A mail with a cleared body is not sampled.

## Step 2 — Result and report-ready

- **Goal:** `classifying` → `done` with `result` per moving category; the report-ready notice is queued (D4, D16).
- **Decisions:**
  - For each category in `movingCategories`: `acted` = acted-on items, `moved` = acted-on items with that `category` and `wouldMove`; `historyOutcome({ acted, moved })` → stored with `upper`. Also store per category the count of all items and of items with `wouldMove`, for the report.
  - `finished_at` set. If this is the first `done` check of the mailbox and `trust_ladder` is on, queue `trust_report_ready` for each linked owner in the same transaction (stage 10 kind; dedup `trust_report:<mailbox id>`).
  - One `info` log line with the check id, counts per category and outcome (no ids of mail). It also logs the share of mail with `\Answered` (N2).
- **Test:**
  7. 60 acted-on items: 1 would move as `notification` → `inconclusive` (1/60 = 0.017); 2 → `fail` (0.033); 0 → `inconclusive` (upper 0.060).
  8. 40 acted-on → every category `no_result`.
  9. First `done` → one outbox row per linked owner; a second check later → no new row.

## Check

`bun test apps/server/test/integration/trust-history-classify.test.ts`

## Done when

- No mail text, subject or address in any log line or item row.
- Proof (`s07`) prints `PROOF_OK`.

## Out of scope

Sent-folder signals (E5a seam: one function `historyActedOn` holds D6). The report page (stage 14).
