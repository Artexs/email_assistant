# F110 stage 07 — History check: sample, classify, result `[risky]`

Part of [`../plan.md`](../plan.md). Risk: LLM spend, LLM use on real mail, exactly-once.

## Step 1 — Sample and classify

- **Goal:** `classifying` writes one `history_check_items` row per sample mail (D10, D11, D12).
- **Files:** `trust/history-classify.ts`; `classifyStored` in `triage` ([interfaces.md](../interfaces.md)): the hard rules, thread context, `classifyEmail`, `decideCategory` with the mailbox thresholds, and the would-do plan (`planActions` + `decidePolicy` as in `assist` with `ASSIST_DEFAULT_SWITCHES` and `categoryAuto` true). No triage row is saved.
- **Decisions:**
  - Sample (D11): mail with `received_at >= window_start`, body not cleared, not own mail, following `TRIAGE_LLM_SCOPE` (`synthetic` → test mail only). Acted-on first (`historyActedOn`, D6), newest first; then the rest ordered by `md5(check_id || email_id)`, to 500.
  - Reuse (review 1 B5): a mail's newest `triage_results` row is reused (`source: triage_result`, no call) only when its `model` and `prompt_version` equal the check `key` and the check reason is not `model_switch`; a rule result (`blocklist`) is always reused. Else `classifyStored`.
  - Pace (review 1 N12): up to 20 mails per run, calls one after another, the run stops after 12 s; the job runs every 15 s.
  - Key guard: each run first compares `runningEvidenceKey` with the check `key`; a mismatch ends the check `no_result` / `key_changed` and queues a new one with reason `model_switch` (also covers a check that was open at a switch).
  - Each item commits alone with its `cost_usd` (`costPerMail(model, tokensIn, tokensOut, at, endpoint)`); `history_checks.cost_usd` = the sum, same transaction.
  - Before each call: cost ≥ $0.25 → `capped = true`, go to Step 2. Unpriced model → `no_result` / `cost_unknown` before any call (Q5).
  - Each call writes `llm.call` with `data.historyCheckId`; the daily-cap count (`countLlmCallsSince` or its caller at `HEAD`) leaves those rows out. M7 cost per mailbox includes them (real spend; stage 25 documents it). The LLM pause applies: reschedule to its end, no attempt. A hard error on one mail: skip it, go on.
- **Test** (`apps/server/test/integration/trust-history-classify.test.ts`, fake LLM client, fixture price):
  1. 60 window mails, 10 acted-on, 1 triaged under the check key → the first run takes the 10 acted-on first; the triaged one makes no call.
  2. A mail triaged by model A, check key model B → one call, item `source: classified` (review 1 T7).
  3. $0.01 per call → stops at 25 calls, `capped`, `cost_usd` 0.25.
  4. A crash after a call and before its commit → one more call for that mail on repeat, one item row.
  5. Unpriced model → `no_result` / `cost_unknown`, zero calls.
  6. 300 normal `llm.call` rows today plus 50 history rows → the triage worker is not capped.
  7. Running key changes between two runs → `no_result` / `key_changed`, one new `queued` check (`model_switch`).
  8. Timing (review 1 T9): fixed clock, 500 window mails, none triaged, fake LLM 0.1 s per call, job runs simulated every 15 s → `done` before connect + 60 min.

## Step 2 — Result and report-ready

- **Goal:** `classifying` → `done` with `result` per moving category; the report-ready notice (D4, D16).
- **Decisions:**
  - Per category in `movingCategories`: `acted` = acted-on items, `moved` = acted-on items with that category and `would_move`; `historyOutcome` → stored with `upper`; also `total` and `wouldMove` counts for the report.
  - The first check of a mailbox that ends `done` or `no_result` (any reason except `key_changed`) queues `trust_report_ready` through `queueTrustNotice` in the same transaction, when `trust_ladder` is on (D16, review 1 N6). Later checks queue nothing.
  - One `info` log: check id, counts and outcome per category, the share of `\Answered` mail (N2). No mail ids.
- **Test:**
  9. 60 acted-on: 1 would move as `notification` → `inconclusive`; 2 → `fail`; 0 → `inconclusive` (upper 0.060).
  10. 40 acted-on → every category `no_result`.
  11. First `done` → one outbox row per owner; a later check → none. A first `no_result` / `no_history` → one row.

## Done when

- No mail text, subject or address in a log line or item row.
- Proof (`s07`) prints `PROOF_OK`.

## Out of scope

Sent signals (E5a: `historyActedOn` is the seam). Pausing a granted category on `fail` (stage 09). The report page (stage 14).

## Carry-over from stage 03 review

- no done or no_result check keeps finished_at NULL (write both together; review-3.md).
