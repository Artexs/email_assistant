> **Status 2026-11-05 — in progress: stages 0–7 done.** 41 stages (0–40), one file per stage in `s1b-shadow-triage/`. Left: stages 8–40, with 4 user checkpoints (after 8, 18, 25; before 37). Stages 37–40 (VPS) are blocked until 2026-11-05T23:30Z and the S1a 48-hour audit check.

# S1b Shadow triage

Scope: `docs/roadmap.md` §2, row S1b. Modules: `docs/modules.md`. Needs: S1a.

## Goal

The system classifies the user's mail and logs what it _would_ do (mode `shadow`). Accuracy is measured per category, and a go/no-go table decides which categories may get automatic moves in S3.

## Done when

- The eval runner (`bun run eval`) reports precision and recall per category on the synthetic set, the injection cases, and at least 100 real labeled mails, or all real pilot INBOX mail of the last 30 days if there are fewer (user decision 2026-11-04). Labels are in `triage_feedback`, from `bun run triage:label`.
- The whitelist rule is 100% correct; no injection case produces a send or a non-delegate recipient.
- A go/no-go table per category is in this file: automatic moves only where precision ≥ 98% (default bar, user may change it) with at least 30 kept rows (default minimum support, user 2026-11-04, user may change it); below the minimum the table says "no-go: too few". The confidence threshold per category comes from the eval data.
- One week of the user's mail is classified in shadow mode; tokens and latency per mail are stored; the cost per mailbox per month is computed.
- A Flash-Lite model is compared with `gemini-3.8-flash` for the classifier role; the choice is logged (this file and `docs/architecture.md` §6.3). This counts as done when the comparison ran, or when `gemini-3.8-flash` stayed unavailable (503) on 3 different Pacific quota days: then the log says "not comparable: 503" with the dates, and the choice is Flash-Lite (user answer Q27, 2026-11-04). A 400 in the comparison = stop and report (not "not comparable").
- The daily LLM call cap works: it counts every LLM call attempt (`audit_log` event `llm.call`). A 429 / 503 / timeout does not move mail to `unsure` (test). The Cloud Billing budget alert moved to `tasks/planned/gemini-billing-budget-alert.md` (user 2026-11-04: it cannot exist without billing).
- No mail body and no secret in the logs (test).

## Plan

### Input (from the task start)

**Gate (changed by the user 2026-11-04, see "User answers" below):** the temporary pilot Interia mailbox counts as test mail and may go to the Gemini free tier. Cloud Billing (or Vertex AI, ADR 0012) stays required before any other person's mail. Stage 0 writes this in ADR 0013 and the docs.

User answers to the plan questions (2026-11-04):

1. Gate: "A mail is just a real one but temporary, it just contains some emails but there is nothing important, we can treat it like test email, and we will use Gemini free tier for now." So the pilot mailbox is test mail; its real mail may go to the free tier now. `TRIAGE_LLM_SCOPE` (default `off`) stays as a safety switch; the pilot uses `all` on the free tier.
2. Classifier model: left to the agents. Decision: default classifier `gemini-3.5-flash-lite` (answered in 837 ms on 2026-11-04, not a preview model). `gemini-3.8-flash` only as the comparison in the eval. `GEMINI_MODEL` (writer) stays `gemini-3.8-flash`.
3. Real-mail done-when items (≥ 100 real labels, one week of shadow mail, cost per mailbox) stay in S1b. The VPS shadow run still waits for the 48-hour test end (2026-11-05T23:30Z) and `tasks/planned/s1a-48h-audit-check.md`. Only the Cloud Billing budget alert moves to `tasks/planned/gemini-billing-budget-alert.md`; the daily call cap stays in S1b. The cost per mailbox per month = stored tokens × the paid-tier price (state the price source and date).

User answers after the cold plan review (2026-11-04):

1. The user accepts the free-tier terms for the pilot mailbox: Google may use human review of the content, and the mailbox holds mail from third-party senders. Step 0.1 records this in ADR 0013 (Consequences) with the source (facts below).
2. Minimum support for "go": default ≥ 30 kept rows per category (the user may change it later). Below it the table says "no-go: too few".
3. Too few real mails: "If there are fewer emails than we expect, we either accept them or check history in the past. If there is still not enough, we keep using the ones we have." Plan: a read-only count of real mail per day before the week (step 37.1); the one-week shadow run stays (step 38.1); fewer than 100 real triaged mails after the week → a one-off backfill of older INBOX mail, up to 30 days back (stages 31–33, step 39.1); still fewer than 100 labels → accept the labels that exist; the report states the count, and the minimum support still decides per category.

User answers after the second cold plan review (2026-11-04):

- Q26 (personal data): the user accepts that the pilot sends third-party personal data to the Unpaid Services, against the terms line "Do not submit sensitive, confidential, or personal information to the Unpaid Services." (https://ai.google.dev/gemini-api/terms). Step 0.1 records this exact point in ADR 0013 Consequences.
- Simple LLM calls: "just make a call to the LLM and don't complicate it with additional parameters like temperature". `platform/llm.ts` sends only the model, the system instruction, the prompt, the JSON response type and schema, and the abort signal. No `temperature`, no `thinkingLevel`, no `thinkingBudget`, no other generation settings. Each model uses its default thinking. Google's thinking page (https://ai.google.dev/gemini-api/docs/thinking, read 2026-11-04): `gemini-3.5-flash-lite` defaults to "minimal", so the default classifier meets the ADR 0012 rule "lowest thinking setting"; `gemini-3.8-flash` defaults to "medium" and does not accept "minimal" (its cost per mail in the comparison shows the effect).
- Q27 (model comparison): keep it simple; see the done-when line above.
- Q28 (Google safety block): a response that Google blocks for safety gets its own code `llm_blocked`. The mail goes to `unsure` at once (reason `llm_blocked`), with one `llm.call` row and no retries. In the eval, a blocked case counts as predicted `unsure`, not as an error.
- Q29 (plan Question 1): answer (a). Build stage 33: the backfill also re-queues stored real INBOX mail of the 30-day window that the worker skipped as `too_old`.

Main-session decisions on the review's open points (2026-11-04):

- Every LLM call attempt writes one `audit_log` row, event `llm.call`, with the model, an outcome code and the tokens; no mail text. The daily cap counts these rows (finding 3).
- Soft errors pause the LLM client (the quota is per project): in memory, backoff 5 → 60 min, one `warn` line per pause (finding 4).
- New `LlmConfigError` for HTTP 401 / 403 / 404: release the mail with no count, pause, log at `error` level (finding 5).
- While on the free tier, the cap counts per America/Los_Angeles day; the default cap of 300 stays (finding 14).
- The model choice result goes to `docs/architecture.md` §6.3 and this file, not into the accepted ADR 0013 (finding 20).
- With `TRIAGE_LLM_SCOPE=all`, the worker triages only the mailbox whose address equals `TEST_MAILBOX_ADDRESS`, until a paid-tier key exists. ADR 0013 states that `synthetic` is not a security boundary (finding 21).
- The cap test checks the `warn` log line (no `onCapReached` hook). In stage 34, a needed prompt change means: stop and report; `classifier-v2` becomes a new [risky] step (finding 23).
- The eval report has a confidence histogram per category (finding 28).

Free-tier terms (read 2026-11-04 from https://ai.google.dev/gemini-api/terms, "Gemini API Additional Terms of Service", effective 2026-03-23):

- "Unpaid Services" (AI Studio and the unpaid quota of the Gemini API): Google uses the submitted content and the responses "to provide, improve, and develop Google products and services and machine learning technologies". "Human reviewers may read, annotate, and process your API input and output." Google disconnects the data from the Google Account, API key and Cloud project before review. "Do not submit sensitive, confidential, or personal information to the Unpaid Services."
- "If you're in the European Economic Area, Switzerland, or the United Kingdom, the terms under 'How Google uses Your Data' in 'Paid Services' apply to all Services, including Google AI Studio and unpaid quota in the Gemini API." Paid data terms: Google does not use prompts or responses to improve its products; it processes them under its Data Processing Addendum; it logs them "for a limited period of time" only to detect Prohibited Use Policy violations and for legal disclosures; the data "may be stored transiently or cached in any country". [not verified: how Google decides that "you're in" the EEA.]
- Use restrictions: "You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom."
- The page gives no fixed number of days for the paid-tier logging. ADR 0012 says 55 days (source of 2026-11-02).

Free-tier limits (third-party sources from 2026-10, not on Google's page, which sends users to the AI Studio rate-limit view) [not verified]:

- Per project: about 500 requests per day for `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite`; only about 20 per day for `gemini-3.8-flash`. Requests per day reset at midnight Pacific time.
- A forum report (2026-11-03): the 3.5 Flash-Lite daily quota once did not reset on time (429 "limit 500").
- Consequences for the plan: the 3.8 Flash comparison must fit in about 20 calls per day (a small subset, resumable over several days); the `LLM_DAILY_CAP` default (300) stays under the Flash-Lite daily quota; the eval runner and the worker share one project quota; 429 stays a soft error.
- Real limits for this project (step 0.2, AI Studio "Gemini API Rate Limit" view, project "Gemini Project", free tier, screenshots from the user 2026-11-04): `gemini-3.5-flash-lite` RPM 15, TPM 250K; `gemini-3.1-flash-lite` RPM 15, TPM 250K; `gemini-3.8-flash` RPM 5, TPM 250K; `gemini-3.6-flash` RPM 5, RPD 20 (chart limit line). RPD for 3.5 Flash-Lite and 3.8 Flash: not visible in the screenshots (bars only) [not verified; third-party sources say about 500 and about 20]. The view also showed "You have reached a rate limit" (3.6 Flash peak 6/5 RPM, not from S1b).
- Defaults for step 9.1 from these numbers: `GEMINI_RPM` = 15 × 0.8 = 12. `LLM_DAILY_CAP` = 300 (the RPD is not known; 300 stays only if RPD ≥ 400).
- Mac and VPS keys (checked 2026-11-04 by the main session, read-only, sha256 prefix compare, no key printed): the user put a key in the VPS `.env` on 2026-11-04; it is the same key as the Mac `.env`. So the Mac and the VPS share one project quota (eval runs and the VPS worker count against the same limits).

Input from the S1a close (2026-11-04):

- User decision: build S1b on the Gemini **free tier** ("we should use the free tier from Gemini").
- There is **no separate test mailbox**: the user has one Interia account (the pilot mailbox). It is temporary and counts as test mail (answer 1 above).
  The triage worker reads real mail only when `TRIAGE_LLM_SCOPE=all` (a switch, default `off`).
- Free-tier check 2026-11-04 (same key as `.env`): `gemini-3.8-flash` and `gemini-3.7-flash` gave `503 high demand` (20–55 s);
  `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` and `gemini-flash-lite-latest` answered in about 1 s. `gemini-2.5-flash-lite` is gone (404).
- Interia facts that touch S1b: `notes/2026-11-03-interia-imap-capabilities.md` (no custom keywords, no `Message-ID` search, UID kept on a move).
- The S1a rescan on 2026-11-04 fetched 7 days of INBOX (`RESCAN_WINDOW_MS` in `mail/sync.ts`), so the pilot DB can hold real mail from about 2026-10-28. Step 37.1 counts it.

Input from S1a (stage 7 review): after a UIDVALIDITY rescan, rows older than 7 days keep the uid from the old UIDVALIDITY. Code that moves or flags mail must not trust `emails.uid` alone: check the mail by Message-ID first. Not used in S1b: S1b makes no mailbox writes. Interia has no Message-ID search (`notes/2026-11-03-interia-imap-capabilities.md`), so S3 owns this check and its design.

### Rules for every step (read before each step)

- Code rules: `docs/code-patterns.md`. Most important here: `packages/core` has no I/O and no `process.env`. Only `platform/llm.ts` imports `@google/genai`. Other modules import a module only through its `index.ts`. Every repository function takes a `TenantContext` and filters by `org_id` (only `insertOrganization`, `insertUser`, `listSyncTargets` do not). Template literals, no `+` for strings. `createLog("<module>")`, never `console.log`.
- **No mail body, no subject, no address, no summary and no secret in a log line or an error message.** Log ids, counts, codes, model names, HTTP status codes and times only. For an error of an unknown kind, log only `describeError(error)` (class name and `code`, step 19.1), never `error.message`. The SDK puts the whole HTTP error body (JSON) into `ApiError.message`: code may parse it, but never logs it.
- **LLM gate (user decision 2026-11-04, ADR 0013 from stage 0):** real mail goes to the LLM only when `TRIAGE_LLM_SCOPE=all`. The default is `off`. No step may change this default. With `all`, the worker triages only the mailbox whose address equals `TEST_MAILBOX_ADDRESS` (the temporary pilot mailbox), until a paid-tier key exists. Any other person's mail needs Cloud Billing (or Vertex AI) first. `synthetic` is not a security boundary (any sender can write an `@ea-seed.test>` Message-ID). Only stage 38 sets `all`, on the VPS.
- **Simple LLM calls (user 2026-11-04):** `platform/llm.ts` sends only the model, the system instruction, the prompt, the JSON response type and schema, and the abort signal. No `temperature`, no thinking setting, no other generation setting. So eval results can change between two runs of the same cases.
- **Shared quota:** the eval runner and the worker use one Gemini project quota (free tier, about 500 requests per day for Flash-Lite, about 20 for `gemini-3.8-flash` [not verified]). A 429 is always a soft error.
- **LLM call count:** every LLM call attempt of the worker writes one `audit_log` row with event `llm.call` (outcome code `ok` or the error code; model; tokens; latency; no mail text). The daily cap counts these rows per mailbox per America/Los_Angeles day.
- Synthetic mail = an `emails` row whose `message_id_header` ends with `@ea-seed.test>` (case-insensitive; SQL `ILIKE '%@ea-seed.test>'`; JS `isSyntheticMessageId`, step 4.1). Real mail = all other rows (also `message_id_header` NULL). `mailbox:seed` makes synthetic ids. Real labels, real metrics and the real cost never include synthetic mail. Eval cases in `evals/` never touch the DB.
- Do not touch the VPS (`ssh home_vm`), its cron, its `.env` or `~/ea-48h-end.sh`. The 48-hour S1a run ends 2026-11-05T23:30Z. Only stages 37–40 work on the VPS.
- Do not commit. Do not print `.env`.
- Checks after each step (the step names which ones):
  - `bun run lint && bun run typecheck && bun run test:unit`
  - with DB: `bun run dev:up && bun run db:migrate && bun run test:int` (dev `db` on port 5433, GreenMail; `.env` has `MIGRATOR_DATABASE_URL`).
- Integration tests: use `withRollback` from `apps/server/test/integration/helpers.ts`, `createOrgWithMailbox`, `insertTestEmail` (step 4.1) and `pauseOtherMailboxes` (step 22.1) from `fixtures.ts`. The dev DB can hold other active mailboxes (manual runs, `mail-jobs.test.ts` says "other rows in the dev DB"): every triage job test calls `pauseOtherMailboxes(trx)` first, inside its rollback transaction. A test that needs a `mailbox_settings` row calls `insertDefaultSettings` (config index): `createOrgWithMailbox` inserts none. A statement that must fail (permission, check constraint) aborts the Postgres transaction: run it inside a savepoint (`trx.savepoint` / raw `SAVEPOINT`) or in its own transaction. Tests that need two connections use their own new org and delete it at the end (`DELETE FROM organizations WHERE id = …` cascades).
- Code that runs in a transaction it may get from a caller uses the S1a pattern from `mail/sync.ts`: `deps.db.isTransaction ? run(deps.db as Transaction<DB>) : deps.db.transaction().execute(run)`.
- Markdown files: check with `bunx prettier --check <files>` (`bun run lint` is ESLint only).

### User checkpoints (user decision 2026-11-04)

The main session stops after the commit of the named stage and gives the user a short summary: what was built, the check commands and their output, open issues. The next stage starts only after the user says go.

1. After stage 8 — tables and queries (schema errors are the most expensive to fix later).
2. After stage 18 — eval: the first precision and recall on synthetic and injection cases.
3. After stage 25 — worker: the whole pipeline runs locally.
4. Before stage 37 — the last check before real mail goes to the VPS shadow run.

### Review model (user decision 2026-11-04)

Stage reviews run on Sonnet, high, also for `[risky]` stages. Opus, high reviews only the critical stages 3 (migration), 4 (claim and release), 11 (prompt and injection guard), 22 and 23 (job claim and release), and the group review at each user checkpoint.

### Stages

Each stage lives in its own file in [`s1b-shadow-triage/`](s1b-shadow-triage/). An implementer or reviewer reads this file (Input, Rules, checkpoints) and only the stage file of its step.
The main session ticks the step boxes in the stage file and the stage box here.

- [x] [Stage 0](s1b-shadow-triage/stage-00-pilot-free-tier-gate-adr-0013-docs-real-limits.md) — Pilot free-tier gate: ADR 0013, docs, real limits (before any real mail reaches the LLM)
- [x] [Stage 1](s1b-shadow-triage/stage-01-core-triage-types-and-hard-rules.md) — Core triage types and hard rules
- [x] [Stage 2](s1b-shadow-triage/stage-02-planners-and-policy.md) — Planners and policy [risky]
- [x] [Stage 3](s1b-shadow-triage/stage-03-s1b-tables-migration.md) — S1b tables migration [risky]
- [x] [Stage 4](s1b-shadow-triage/stage-04-email-claim-and-release-queries.md) — Email claim and release queries [risky]
- [x] [Stage 5](s1b-shadow-triage/stage-05-sender-rule-and-audit-repositories.md) — Sender rule and audit repositories [risky]
- [x] [Stage 6](s1b-shadow-triage/stage-06-actions-repository.md) — Actions repository [risky]
- [x] [Stage 7](s1b-shadow-triage/stage-07-triage-repository-writes.md) — Triage repository: writes [risky]
- [ ] [Stage 8](s1b-shadow-triage/stage-08-triage-repository-lists-with-the-real-synthetic.md) — Triage repository: lists with the real / synthetic filter [risky]
- [ ] [Stage 9](s1b-shadow-triage/stage-09-llm-config-keys.md) — LLM config keys [risky]
- [ ] [Stage 10](s1b-shadow-triage/stage-10-llm-client.md) — LLM client [risky]
- [ ] [Stage 11](s1b-shadow-triage/stage-11-classifier-and-prompt-v1.md) — Classifier and prompt v1 [risky]
- [ ] [Stage 12](s1b-shadow-triage/stage-12-eval-case-schema-address-split-and-subset-rule.md) — Eval case schema, address split and subset rule [risky]
- [ ] [Stage 13](s1b-shadow-triage/stage-13-eval-cases-urgent-and-needs-reply.md) — Eval cases: `urgent` and `needs_reply` [risky]
- [ ] [Stage 14](s1b-shadow-triage/stage-14-eval-cases-info-and-notification.md) — Eval cases: `info` and `notification` [risky]
- [ ] [Stage 15](s1b-shadow-triage/stage-15-eval-cases-spam-blocklist-and-injection.md) — Eval cases: `spam`, blocklist and injection [risky]
- [ ] [Stage 16](s1b-shadow-triage/stage-16-eval-metrics-and-go-no-go.md) — Eval metrics and go/no-go [risky]
- [ ] [Stage 17](s1b-shadow-triage/stage-17-eval-runner-logic.md) — Eval runner logic [risky]
- [ ] [Stage 18](s1b-shadow-triage/stage-18-eval-report-and-cli.md) — Eval report and CLI [risky]
- [ ] [Stage 19](s1b-shadow-triage/stage-19-triage-save-path.md) — Triage save path [risky]
- [ ] [Stage 20](s1b-shadow-triage/stage-20-triage-of-one-email-success-path.md) — Triage of one email: success path [risky]
- [ ] [Stage 21](s1b-shadow-triage/stage-21-triage-of-one-email-llm-error-rules-and-the-paus.md) — Triage of one email: LLM error rules and the pause [risky]
- [ ] [Stage 22](s1b-shadow-triage/stage-22-triage-job-mailboxes-scope-settings-claim.md) — Triage job: mailboxes, scope, settings, claim [risky]
- [ ] [Stage 23](s1b-shadow-triage/stage-23-triage-job-stop-on-a-pause-release-on-a-mailbox.md) — Triage job: stop on a pause, release on a mailbox error [risky]
- [ ] [Stage 24](s1b-shadow-triage/stage-24-cost-gates-7-day-rule-with-the-backfill-waiver-d.md) — Cost gates: 7-day rule with the backfill waiver, daily cap [risky]
- [ ] [Stage 25](s1b-shadow-triage/stage-25-server-wiring-and-the-log-test.md) — Server wiring and the log test [risky]
- [ ] [Stage 26](s1b-shadow-triage/stage-26-feedback-and-labeling-cli.md) — Feedback and labeling CLI
- [ ] [Stage 27](s1b-shadow-triage/stage-27-rules-cli-and-cost-report.md) — Rules CLI and cost report
- [ ] [Stage 28](s1b-shadow-triage/stage-28-real-label-eval.md) — Real-label eval [risky]
- [ ] [Stage 29](s1b-shadow-triage/stage-29-eval-mail-seed-and-eval-cases-in-the-server-imag.md) — Eval mail seed and eval cases in the server image [risky]
- [ ] [Stage 30](s1b-shadow-triage/stage-30-eval-subset-and-resume.md) — Eval subset and resume [risky]
- [ ] [Stage 31](s1b-shadow-triage/stage-31-one-off-inbox-backfill-backfillinbox.md) — One-off INBOX backfill: `backfillInbox` [risky]
- [ ] [Stage 32](s1b-shadow-triage/stage-32-one-off-inbox-backfill-tool-and-cli.md) — One-off INBOX backfill: tool and CLI [risky]
- [ ] [Stage 33](s1b-shadow-triage/stage-33-re-queue-too-old-mail-in-the-backfill-window.md) — Re-queue `too_old` mail in the backfill window [risky]
- [ ] [Stage 34](s1b-shadow-triage/stage-34-full-flash-lite-eval-run.md) — Full Flash-Lite eval run [risky]
- [ ] [Stage 35](s1b-shadow-triage/stage-35-docs-and-notes.md) — Docs and notes
- [ ] [Stage 36](s1b-shadow-triage/stage-36-model-comparison-with-gemini-3-8-flash.md) — Model comparison with `gemini-3.8-flash` [risky]
- [ ] [Stage 37](s1b-shadow-triage/stage-37-vps-deploy-synthetic-smoke-run-real-mail-count.md) — VPS: deploy, synthetic smoke run, real-mail count [risky]
- [ ] [Stage 38](s1b-shadow-triage/stage-38-vps-real-mail-shadow-week.md) — VPS: real-mail shadow week [risky]
- [ ] [Stage 39](s1b-shadow-triage/stage-39-vps-backfill-of-older-inbox-mail.md) — VPS: backfill of older INBOX mail [risky]
- [ ] [Stage 40](s1b-shadow-triage/stage-40-vps-final-real-mail-eval-cost-go-no-go.md) — VPS: final real-mail eval, cost, go/no-go [risky]

### Results (filled in stages 34, 36 and 40)

Go/no-go table: _not yet_. Model choice: _not yet_.

## Questions for the user

None open (Q26–Q29 answered 2026-11-04).

## Not verified

- Gemini free-tier limits per project (third-party sources 2026-10, not Google's page): about 500 requests per day for `gemini-3.5-flash-lite` / `gemini-3.1-flash-lite`, about 20 per day for `gemini-3.8-flash`. Google's rate-limits page confirms only "per project" and "RPD reset at midnight Pacific time" (reviewer, 2026-11-04). Requests per minute: not known (`GEMINI_RPM` 10 is a guess). Step 0.2 replaces these with the AI Studio numbers.
- Forum report 2026-11-03: the 3.5 Flash-Lite daily quota once did not reset on time (429 "limit 500").
- How to tell a daily-quota 429 from a per-minute 429 in the SDK error (not needed: both pause the client with the same backoff).
- Free-tier terms: how Google decides that "you're in" the EEA (account, project, billing country or request origin); and the reading that "making API Clients available to users" does not cover the developer's own use (step 0.1; not legal advice).
- The terms page (effective 2026-03-23) gives no fixed number of days for the paid-tier logging; ADR 0012 says 55 days (source of 2026-11-02).
- Whether the SDK stops a request on `abortSignal` (step 10.1 test with a fake `generate`; the timeout also wraps the promise).
- Which `finishReason` values besides `SAFETY` mean a safety block for `llm_blocked` (field names checked in the SDK 2.32.0 types, step 10.1).
- Whether Gemini `responseJsonSchema` accepts all keywords of Zod 4 `z.toJSONSchema()` output (`maxLength`, `pattern`, `nullable` forms).
- How the SDK reports a network error (class and `status`) as opposed to an `ApiError`.
- Flash-Lite prices (stage 16 reads them from https://ai.google.dev/gemini-api/docs/pricing).
- Kysely types for `with(...).updateTable(...).from(...)` (step 4.1 falls back to the `sql` template).
- `America/Los_Angeles` in Bun's `Intl` time-zone data (the step 24.1 test proves it).
- Bun `prompt()` in `docker compose run --rm` without `-T` (step 26.2 manual run on the Mac; first VPS use in step 38.1).
- Postgres runs `ON DELETE CASCADE` into `audit_log` with the owner's rights, so the `REVOKE DELETE` from `app` does not block a mailbox delete (S6 delete function; not used in S1b).
- `emails.message_id_header` keeps the angle brackets (`<…@ea-seed.test>`) for Interia: the S1a mapper keeps the envelope value as it is (`imap/mapper.ts`, tests use `<…>`); step 37.1 checks it on the pilot DB with Q1.

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-02: Created from `docs/roadmap.md` and `docs/architecture.md` §11.
- 2026-11-02: Changed after the cold review (`tasks/done/mvp-plan-review.md`) and the user's answers (IMAP, home VPS, own Postgres).
- 2026-11-04: S1a closed. User: start S1b on the Gemini free tier; handoff `~/.pi/agent/notes/2026-11-04-handoff-s1b-shadow-triage.md`.
- 2026-11-04: Plan written (16 stages, 3 questions).
- 2026-11-04: User answers: (1) the temporary pilot mailbox counts as test mail and may use the free tier; billing before any other person's mail; (2) default classifier `gemini-3.5-flash-lite`; (3) real-mail items stay in S1b, the budget alert moves to `tasks/planned/gemini-billing-budget-alert.md`. Plan updated: stage 0 (ADR 0013, docs, user reads limits), 6.1 defaults, 11.1 stop on soft error, 14.4 eval subset and resume, 15.1 comparison within the 3.8 Flash quota, 16.2 unblocked by ADR 0013.
- 2026-11-04: Cold plan review: FAIL (findings 1–25, 28). User answers (free-tier terms accepted, minimum support 30, backfill when too few real mails) and main-session decisions added under "Input". Plan updated to 31 stages (0–30). Step map old → new: 0.x → 0.x; 1.x → 1.x; 2.1 → 2.1; 3.1 → 3.1 (+ `emails.backfilled_at`); 4.1 → 4.1; 5.1 → 5.1 (rules, audit, actions) + 6.1 (triage repo); 6.1/6.2 → 7.1/7.2; 7.1 → 8.1; 8.1 → 9.1 (+ `selectCases`); 9.1 → 10.1; 10.1 → 11.1 (runner logic) + 12.1 (report, CLI); 11.1 → 13.1 (success path) + 14.1 (error rules, pause) + 15.1 (job); 12.1 → 16.1 (cost gates) + 17.1 (wiring, log test); 13.x → 18.x; 14.1 → 19.1; 14.2 → 20.1; 14.3 → 20.2; 14.4 → 21.1; new 22.1 (backfill), 23.1 (re-queue, Question 1); 15.1 → 24.1 (full run) + 26.1 (comparison); 15.2 → 25.1 + 25.2; 16.1 → 27.1; 16.2 → 28.1 + 29.1 (backfill run) + 30.1 (final eval).
- 2026-11-04: Second cold plan review: FAIL (5 major, 20 minor, 4 questions); fixed. User answers: Q26 personal data on the free tier accepted; simple LLM calls (no temperature, no thinking setting); Q27 "not comparable: 503" after 3 Pacific quota days counts as done; Q28 `llm_blocked` → `unsure` at once; Q29 answer (a), stage 33 is built. 41 stages (0–40). Old → new for the tail: 24 → 34, 25 → 35, 26 → 36, 27–30 → 37–40. User checkpoints added (after stages 8, 18, 25; before 37).
- 2026-11-04: User approved the plan; committed as 44dc707. Handoff for the build: `~/.pi/agent/notes/2026-11-04-handoff-s1b-build.md`.
- 2026-11-04: Stage 0 done: ADR 0013, gate lines in architecture, roadmap, product brief (also the §6.3 / §5 headings and brief Q11, review fixes). Prettier: the 6 old docs files already failed `--check` at HEAD; the edits add no new problems (main-session bar). Limits not read; user chose the defaults. VPS `GEMINI_API_KEY` is empty. Reviewed: PASS.
- 2026-11-04: Step 0.2 update: user sent the AI Studio limits (Flash-Lite RPM 15, 3.8 Flash RPM 5, TPM 250K; RPD not visible). Defaults: `GEMINI_RPM` 12, `LLM_DAILY_CAP` 300. VPS key set by the user: same key and project as the Mac.
- 2026-11-04: Stage 1 done: core triage types, settings, analysis schema, hard sender rules, threshold, untrusted-text marking. Review fixes: date/phone and URL masking, `noreply+tag`. Stage 27 gets the pattern check (leading `@`, domain without dot). Reviewed: PASS.
- 2026-11-04: Stage 2 done: category planners and the policy truth table (shadow logs only; `unsure` move needs only `move_unsure` and `movesSupported`; `mark_read` ignores `movesSupported`). Reviewed: PASS.
- 2026-11-05: Stage 3 done: migration `20261104000001_triage.sql` (5 tables, `emails.backfilled_at`, append-only `audit_log`). Review fix: `actions.depends_on_action_id` / `reverses_action_id` are composite FKs with `org_id` (deviation from the plan text, stage file updated). Reviewed: PASS (Opus, 2 rounds). Also commits the user's review-model edits (README table row, task head).
- 2026-11-05: Stage 4 done: claim/release/finish/thread-context queries for emails (`FOR UPDATE SKIP LOCKED` CTE, `locked_at` token), `insertTestEmail`, synthetic Message-ID helpers. Reviewed: PASS (Opus). Accepted risk (reviewer question): a stale `processing` row re-claimed after a hard crash does not count an attempt, so a mail that kills the process each time is retried every 5 min; the daily LLM cap bounds cost. Stage 22 may count the attempt on stale re-claim.
- 2026-11-05: Stage 5 done: `listSenderRules`, `insertSenderRule`, audit module (`recordAudit`, `countLlmCallsSince`, `auditEvents`), two-tenant tests. Reviewed: PASS (Sonnet).
- 2026-11-05: Stage 6 done: actions repository (`createPlanned`, `listActionsForEmail`, `listSummaries`), tenant tests. Reviewed: PASS (Sonnet). Accepted minors: rows of one plan share `created_at`, so their order is by uuid; `listSummaries` has no ORDER BY (one summary per email by idempotency key).
- 2026-11-05: Stage 7 done: triage repository writes (`insertTriageResult`, `latestTriageResult`, `insertFeedback`), tenant and FK tests. Reviewed: PASS (Sonnet).
