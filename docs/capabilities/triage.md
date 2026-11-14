# Triage

> Checked against the code at `6fdea61`, 2026-11-14.

## What it does now

Triage turns a stored mail with status `pending` into a category, a short reason, a summary for `info` mail and a plan of actions. The job `triage.worker` runs every 15 seconds. It claims a batch of 5 mails per mailbox, oldest first. First it applies the age rules and the hard rules (the sender rules of the mailbox). If a mail needs the LLM, one call with the role `classifier` returns a category, a confidence, a reason code and extracted fields. The service then decides the final category by the thresholds. It writes the `triage_results` row, the planned actions and the audit rows in one transaction. The policy decides if each action is `ready`, `awaiting_approval` or `logged` (`docs/architecture.md` §4.3). Users give feedback with Telegram buttons, the web panel, the Undo button, or by moving a mail back; a CLI labels mail for the eval. Without `TRIAGE_LLM_SCOPE` the worker does not run.

## Rules

1. **Hard rules before the LLM.** A blocklisted sender (and not whitelisted) gives `spam` with reason `blocklist` and confidence 1, with no LLM call. A whitelisted or VIP sender gets the category list without `spam`. A VIP is also whitelisted. The category `delegation` is allowed only when the organization has at least one active delegate. The rules are in `packages/core/src/triage/rules.ts`; the sender rules are per mailbox or per organization (`apps/server/src/modules/config/rules.ts`).
2. **Age rules.** Mail older than 7 days is `skipped` with `too_old`, unless `emails.backfilled_at` is set. Mail received more than 24 h before `organizations.resumed_at`, and stored before `resumed_at` + 24 h, is `skipped` with `suspended_backlog` (no LLM call). A backfilled mail that lost its body while it waited (older than 7 days in `pending`) is `skipped` with `body_expired`. A skipped mail still closes an open delegation when it is a reply of the delegate.
3. **The classifier call.** `classifyEmail` makes one call with the role `classifier` and the prompt `classifier-v2` from the prompt registry (`apps/server/src/modules/triage/prompts/index.ts`). The input is the mail, the sender context (whitelisted, VIP, no-reply), the allowed categories, the delegates list and the last 3 mails of the same `thread_key` as context. Mail text is marked as untrusted (`markUntrustedText`), with a random nonce for each call. For a test mail (a synthetic `Message-ID` or a sender in `TEST_SENDER_ADDRESSES`), the thread context comes from test mail only. The output must match a Zod schema built for the allowed categories and the delegate ids. A category outside the allowed list is an `LlmOutputError`. A delegate id that is not in the list becomes null. The LLM returns data only: it never names a free-form recipient.
4. **Categories and thresholds.** The final category is the model category, or `unsure` when the confidence is below the threshold of that category (`decideCategory`; reason code in the audit row: `below_threshold`). The start threshold is 0.7 per category (`mailbox_settings.category_policy`). The categories and their plans: `docs/architecture.md` §4.2.
5. **The policy table.** `decidePolicy` (pure, `packages/core/src/triage/policy.ts`) returns `apply`, `await_approval` or `log_only` for each planned action. The table and the modes: `docs/architecture.md` §4.3. Mail from the spam folder uses another plan (`fromJunk` in `planActions`).
6. **`TRIAGE_LLM_SCOPE`.** `off` (default): no worker. `synthetic`: the worker claims only test mail: a synthetic `Message-ID` or a sender in `TEST_SENDER_ADDRESSES`. `all`: all mail of every active mailbox of an organization that is not `suspended`. The key of the provider must be set when the scope is not `off`. `LLM_PROVIDER` (`gemini` or `openai`) picks the provider of the classifier.
7. **Retries live on the row that failed** (rule 7 of `docs/architecture.md` §4.1, first paragraph, stays there). The triage worker (S1b; `triage/service.ts`, `triage/jobs.ts`, `triage/pause.ts`) applies this rule to the email as follows:
   - **Soft error** (timeout, a lost network connection, HTTP 429, 500, 502, 503, 504): the LLM client of the process pauses. The pause is 5 min.
     Each next soft or config error without a good LLM answer in between doubles it, up to 60 min. The pause is in memory and covers all mailboxes.
     The mail goes back to `pending` with `next_attempt_at` = the pause end. It gets no count. The job claims no mail during the pause.
     Claimed mail that the worker did not try keeps its old `next_attempt_at`. One `warn` line per pause.
   - **Config error** (HTTP 401, 402, 403, 404; HTTP 400 with `FAILED_PRECONDITION` or `API_KEY_INVALID`): the same pause, no count.
     One `error` line names the keys to check.
   - **Safety block** (`llm_blocked`): the mail becomes `unsure` at once. The worker writes one `llm.call` row and does not retry.
   - **Hard error** (an HTTP 400 without the two config signs, an unreadable answer, an error without an HTTP status and without a network code, or any other HTTP status that is not listed):
     the mail waits a fixed 5 min and `attempts` goes up by 1. At 3 attempts the mail becomes `unsure` (`triage_error`).
     A stale claim (`locked_at` older than 5 min) that a later run takes back also counts one attempt.
     A mail that reaches 3 attempts this way becomes `unsure` (`triage_error`) without an LLM call.
   - **Error outside the LLM call** (thread read, save, DB): the mail in work counts one try, with a 5-min wait, like a hard error.
     At 3 tries it becomes `unsure` (`triage_error`). If that save fails, the mail goes back with a count.
     Mail that the worker claimed later in the same batch goes back with no count. The error stops this mailbox only; the next mailbox runs.
   - **Shutdown:** the server waits up to 30 s for a running batch. A batch that is cut off leaves claimed mail in `processing`;
     the next start takes it back and counts one attempt for each mail.
8. **Cost limits** (moved from `docs/architecture.md` §4.1 rule 8; the headline stays there). The daily cap (default 300, `LLM_DAILY_CAP`) counts every LLM call attempt (`audit_log` event `llm.call`)
   per mailbox per `America/Los_Angeles` day (the quota day of the free tier). At the cap the mail goes back to `pending`
   with `next_attempt_at` = the start of the next quota day, with no count. Mail older than 7 days is not sent to the LLM: status `skipped` (reason `too_old`);
   the digest lists it as "not processed" (ADR 0012). Mail with `emails.backfilled_at` set skips the 7-day rule (one-off backfill, `docs/architecture.md` §6.1).
   - Check against the code: the cap holds LLM calls only, so a blocklist mail or a too-old mail after a capped mail is still handled. The job writes one `warn` line for each mailbox and quota day, and calls the operator notice `llm_cap` ([digest-and-notices.md](digest-and-notices.md)).
9. **One transaction per mail.** `saveTriage` share-locks the settings row and compares the settings version. If the settings changed after the batch read them, nothing is written and the mail goes back without a count; the next run uses the new settings. The same transaction writes the `emails` status `triaged`, the `triage_results` row, the actions (`ready`, `awaiting_approval` or `logged`), the delegation row for a `delegation` mail, and the audit rows `email.triaged` and `action.planned`. A reply of a delegate closes the open delegation in this transaction.
10. **Feedback sources** (moved from `docs/architecture.md` §4.4): labeling CLI (S1b); ✅ / ✏️ buttons under each digest line (S2); the `/review` page (✅ / ✏️ per item, flag `review_command`, source `review`; [digest-and-notices.md](digest-and-notices.md) rule 9); the Undo button (S3);
    a mail that the user moves back to a synced folder after a system move (`docs/architecture.md` §6.1); the web panel (S5).
    Every source writes a `triage_feedback` row through `triage.recordFeedback()`. A known mail is never triaged again (no loop).
    - The source `review` is for the labels of the Telegram `/review` page (a random sample of unlabelled real mail, `listReviewSample` in `triage/review-repo.ts`); its buttons are `vr`, `vc`, `ve`, `vx` (see [digest-and-notices.md](digest-and-notices.md) rule 10), so metrics can tell them from digest taps.
    - The source `answered_check` is written by the answered check of `/review` (F100 stage 15); no code writes it yet.
    - Check against the code: `triage.returned` (every 15 s) and the Undo path also call `recordFeedback`; the Telegram handler and `POST /api/feedback` set `skipIfSame`, so the same answer twice writes no row.
11. **Buttons under a digest line (S2)** (moved from `docs/architecture.md` §4.4): ✅ means "the shown category is right": it writes `true_category` = the shown category (verdict `right`).
    ✏️ opens a picker with five categories (Urgent, Reply, Info, Notification, Spam) and Cancel; a pick writes `true_category` = the pick
    (verdict `right` or `wrong`). The latest row of a mail wins (as in `listLabeledResults`). The same answer twice writes nothing
    (the bot answers "Already saved"). An `unsure` line has only ✏️, because a verdict without a category is not valid for `unsure`.
12. **Feedback rows** (moved from `docs/architecture.md` §4.4): `verdict` (`right` / `wrong`) and an optional `true_category`. A row with a `true_category` counts for precision and recall.
    A row with only `wrong` counts only against the precision of the predicted category.
    Rows with the source `review` come from a random sample of recent real mail, not from the mail the user chose to label: they are the unbiased base for the metrics of E3a.
13. **Eval on real mail** (moved from `docs/architecture.md` §4.4): the eval runner reads the labels from `triage_feedback` in the DB. Real labels never go to git. Real labels leave out test mail: mail with a synthetic `Message-ID` and mail from a sender in `TEST_SENDER_ADDRESSES` (the check is case-insensitive and also drops old feedback on such mail).
    Real-mail evals use mail younger than 30 days (the body is cleared after that, `docs/architecture.md` §7). Pilot exception: backfilled mail up to 180 days (`docs/architecture.md` §6.1).
    - `bun run eval` runs the cases of `evals/cases` (80 synthetic, 16 injection, 12 delegation) against one provider and model, and prints precision and recall per category with a bar (default 0.98) and a minimum support (`--min-kept`, default 30). `bun run eval --real --org-id <uuid> --mailbox-id <uuid>` reads the labels from the DB and makes no LLM call. The gate for `auto` per category uses the same report (`goNoGoFor`: precision at least 98% on at least 30 labelled rows of the mailbox).
    - `bun run eval --sim <scenario> --part dev|holdout|week` runs a synthetic corpus part (`evals/sim/<scenario>/`) through a worker pool (8 calls in flight, 240 requests per minute by default). A run stops at its cap: $1 per run, and the $20 month cap counted from a spend ledger outside git (`$XDG_STATE_HOME/email-assistant/eval-spend.jsonl`). A stopped run is not complete (exit 2) and resumes from its state file; a lock file keeps two runs off one state file. A model without a price in `llmPrices`does not start. With`--judge`(and the optional`--judge-provider`and`--judge-model`, which override the `judge` role row) every planned delegation or clarification draft is checked by code (`draftCodeChecks`: recipient, clean text, language, length, planted strings) and graded by the `judge` role (`judge-v1`); the report gets a `## Draft judge`section. The judge refuses to start when its provider is the classifier's provider, when its API key is missing (the message names the key) or when its model has no price; a judge call counts in the cap, and judge errors stop the run like classifier errors. The`holdout` part needs a frozen corpus, and its report prints counts, not case ids.
    - Synthetic corpora (a made-up company, mail written by agents, labels fixed before the text) are planned and checked with `bun run sim`; the runbook is `evals/sim/README.md`. A complete corpus freezes into a version with `manifest.json` (counts and hashes); the owner audit (30 random and up to 20 contested cases) is made and applied with `sim audit-list` and `sim audit-apply`.
14. **Success metric** (moved from `docs/architecture.md` §4.4; not built) ("share of mail handled without the user", target 80–90%):
    handled = mail in `spam`, `notification`, `info`, or `delegation` sent after one tap, with an applied plan
    that the user did not undo or correct within 7 days. Share = handled ÷ all triaged mail. One line in the weekly digest.
    The weekly line is not built yet (follow-up: the tickets F033-handled-share-metric and F042-handled-share-delegations, now part of E3a, F100).
15. **Labels and cost tools.** `bun run triage:label --org-id <uuid> --mailbox-id <uuid>` shows unlabeled triaged mail one by one (`--synthetic` for test mail, also from a sender in `TEST_SENDER_ADDRESSES`); `--email-id <uuid>` with `--category`, `--right` or `--wrong` labels one mail. `bun run triage:cost --org-id <uuid> --mailbox-id <uuid> [--days 7] [--mail real|synthetic]` (test-sender mail counts as `synthetic`) prints per model the result count, the average tokens, the latency p50 and p95, the average cost per mail and the monthly cost. `bun run llm:check` sends the real triage schema to one provider.

## Entry points

| Kind     | Name                                                                                                                                  | Where                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| job      | `triage.worker` (`*/15 * * * * *`; only when the scope is not `off`)                                                                  | `apps/server/src/modules/triage/jobs.ts`        |
| job      | `triage.returned` (`*/15 * * * * *`)                                                                                                  | `apps/server/src/modules/triage/returned.ts`    |
| route    | `POST /api/feedback`                                                                                                                  | `apps/server/src/modules/triage/routes.ts`      |
| route    | `POST /api/actions/undo`                                                                                                              | `apps/server/src/modules/triage/routes.ts`      |
| Telegram | callbacks `fr:`, `fc:`, `fe:`, `fx:`, `fu:` (feedback and Undo buttons), `vr:`, `vc:`, `ve:`, `vx:` (review buttons, source `review`) | `apps/server/src/modules/channels/callbacks.ts` |
| CLI      | `bun run triage:label`                                                                                                                | `apps/server/src/scripts/triage-label.ts`       |
| CLI      | `bun run triage:cost`                                                                                                                 | `apps/server/src/scripts/triage-cost.ts`        |
| CLI      | `bun run eval`                                                                                                                        | `apps/server/src/scripts/eval.ts`               |
| CLI      | `bun run sim`                                                                                                                         | `apps/server/src/scripts/sim.ts`                |
| CLI      | `bun run llm:check`                                                                                                                   | `apps/server/src/scripts/llm-check.ts`          |
| function | `triageOne`, `saveTriage`, `finishTriageError`                                                                                        | `apps/server/src/modules/triage/service.ts`     |
| function | `classifyEmail`                                                                                                                       | `apps/server/src/modules/triage/classifier.ts`  |
| function | `judgeDraft`                                                                                                                          | `apps/server/src/modules/triage/judge.ts`       |
| function | `recordFeedback`, `recordWebFeedback`                                                                                                 | `apps/server/src/modules/triage/feedback.ts`    |
| function | `createLlmPause`                                                                                                                      | `apps/server/src/modules/triage/pause.ts`       |
| function | `goNoGoFor`, `setCategoryAutoWithGate`                                                                                                | `apps/server/src/modules/triage/gate.ts`        |
| function | `requeueBackfillWindow`                                                                                                               | `apps/server/src/modules/triage/backfill.ts`    |
| function | `applyHardRules`                                                                                                                      | `packages/core/src/triage/rules.ts`             |
| function | `decideCategory`                                                                                                                      | `packages/core/src/triage/threshold.ts`         |
| function | `planActions`                                                                                                                         | `packages/core/src/triage/planners.ts`          |
| function | `decidePolicy`                                                                                                                        | `packages/core/src/triage/policy.ts`            |
| function | `createLlmClient` (`generate` per role)                                                                                               | `apps/server/src/platform/llm/client.ts`        |

## Data

`emails.status` flow (moved from `docs/architecture.md` §4.6):

```
emails.status:   pending → processing → triaged → done                (done = all its actions have an end status)
                 processing → pending                                 (soft error, config error or daily cap: no count; untried claimed mail keeps its next_attempt_at)
                 processing → pending                                 (hard error with tries left: attempts + 1, next try after 5 min)
                 processing → pending                                 (error on the mailbox, for example a DB error: untried claimed mail goes back, no count)
                 processing → triaged as `unsure`                     (after 3 hard errors, reason triage_error)
                 processing → triaged as `unsure`                     (safety block, reason llm_blocked)
                 processing → processing                              (stale claim: locked_at older than 5 min, taken again by a later run;
                                                                       the take-back counts one attempt; a mail at 3 attempts ends as unsure / triage_error without an LLM call)
                 processing → skipped                                 (older than 7 days and not backfilled, reason too_old)
                 processing → skipped                                 (received more than 24 h before resumed_at and not backfilled, reason suspended_backlog; tenancy-and-plans.md § Rules, rule 3, Resume)
                 skipped → pending                                    (one-off backfill re-queue of too_old mail in the window)
```

- `emails.status` is one of `pending`, `processing`, `triaged`, `done`, `skipped`; `skip_reason` holds `too_old`, `suspended_backlog` or `body_expired`; `attempts`, `next_attempt_at` and `locked_at` drive the claim (`FOR UPDATE SKIP LOCKED`).
  - Check against the code: no code writes the status `done`. The check constraint of `emails.status` allows it, but a mail stays `triaged` when its actions end, so the flow `triaged → done` above does not happen today.
- `triage_results`: `category`, `vip`, `confidence`, `reason_code`, `reason`, `fields` (with `model_category`), `model`, `prompt_version`, `tokens_in`, `tokens_out`, `latency_ms`. A mail can have several rows; the newest wins.
- `triage_feedback`: `verdict` (`right`, `wrong`), `true_category`, `source` (`cli`, `telegram`, `undo`, `imap_move`, `web`, `review`, `answered_check`), `user_id`.
- `mailbox_settings`: `mode`, `tool_switches`, `category_policy` (per category: `threshold`, `auto`); the job compares a settings version (rule 9).
- `sender_rules`: `pattern`, `kind` (`whitelist`, `blocklist`, `vip`); at most 1000 per organization.
- Audit events: `llm.call` (one per call attempt: role, prompt version, model, outcome, tokens, latency), `email.triaged`, `email.skipped`, `email.requeued`, `action.planned`.

## Limits

- No phishing flag, no attachments in the prompt, no urgency context: E3b (F109).
- No weekly handled-share line: E3a (F100).
- The gate on real labels (precision at least 98% on at least 30 labels) stays until ADR 0028 (proposed) changes it; E3 sets the numbers.
- A junk-folder wave can use the shared daily cap: `F063-junk-llm-cap`.
- Only the `classifier` role has a prompt. The roles `judge` (E2a), `drafter` (E6a), `extractor` (E5b) and `escalation` (E3b) have none yet.
- The LLM pause is in memory: a restart clears it. `/status` and the digest read the pause from the `llm.call` audit rows (`latestLlmPause`), so they show it after a restart too (flag `llm_pause_line`).

## Decisions

- ADR 0003 (plan, policy, commit), ADR 0007 (Gemini), ADR 0012 (LLM data and cost), ADR 0013 (pilot mailbox, free tier), ADR 0015 (LLM provider switch), ADR 0028 (proposed: autonomy evidence without user labels).
- PD-003 (metrics M1–M8), PD-056 (E3 splits into E3a Measure and E3b Improve).
- `docs/architecture.md` keeps the flow, rules 1–5 (§4.1), the categories (§4.2) and the policy table (§4.3).

## Tests

- `apps/server/test/integration/triage-job.test.ts`
- `apps/server/test/integration/triage-feedback.test.ts`
- `apps/server/test/integration/triage-gate.test.ts`
- `apps/server/test/integration/triage-repo.test.ts`
- `apps/server/test/integration/triage-review-sample.test.ts`
- `apps/server/test/integration/triage-requeue.test.ts`
- `apps/server/test/integration/triage-returned.test.ts`
- `apps/server/src/modules/triage/classifier.test.ts`
- `apps/server/src/modules/triage/pause.test.ts`
- `apps/server/src/modules/triage/eval.test.ts`
- `apps/server/src/modules/triage/eval-judge.test.ts`
- `apps/server/src/modules/triage/judge.test.ts`
- `apps/server/src/scripts/eval-args.test.ts`
- `apps/server/src/scripts/eval-judge-setup.test.ts`
- `apps/server/src/scripts/eval-ledger.test.ts`
- `apps/server/src/scripts/eval-sim-load.test.ts`
- `packages/core/src/sim/draft-checks.test.ts`
- `packages/core/src/triage/planners.test.ts`
- `packages/core/src/triage/policy.test.ts`
- `packages/core/src/triage/rules.test.ts`
- `packages/core/src/triage/threshold.test.ts`
