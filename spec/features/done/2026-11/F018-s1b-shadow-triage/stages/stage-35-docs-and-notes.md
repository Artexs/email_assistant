# s1b-shadow-triage — Stage 35

Part of [`../plan.md`](../plan.md). Read that file's "Input" and "Rules for every step" first.

## Stage 35 — Docs and notes

- [x] **35.1 Docs describe what S1b built**
  - Goal: the docs describe the current state of the triage pipeline, its config and its scripts.
  - Files: `docs/architecture.md`, `docs/modules.md`, `docs/roadmap.md`, `docs/code-patterns.md` (only if a rule changed).
  - Interfaces: none (docs only).
  - Decisions (docs describe the current state; decisions stay in ADRs; do not change the decision text of ADR 0007, 0012 or 0013):
    - architecture §4.1 rule 7 (review finding 20):
      - Soft errors (timeout, 429, 5xx, network) pause the LLM client of the process with a backoff of 5 → 60 min (in memory). The mail goes back to `pending` with `next_attempt_at` = the pause end, no count. Claimed mail that was not tried keeps its old `next_attempt_at`.
      - Config errors (HTTP 401, 402, 403, 404; 400 with `FAILED_PRECONDITION` or `API_KEY_INVALID`): the same pause, no count, one `error` log line.
      - Safety block (`llm_blocked`): the mail goes to `unsure` at once, one `llm.call` row, no retry.
      - Hard errors: a fixed 5-minute wait and `attempts + 1`; after 3 hard errors: `unsure` (`triage_error`).
    - architecture §4.1 rule 8: the cap counts every LLM call attempt (`audit_log` event `llm.call`) per mailbox per America/Los_Angeles day while on the free tier (the quota day). At the cap the mail waits until the next quota day. Mail with `emails.backfilled_at` set skips the 7-day rule (one-off backfill, user 2026-11-04).
    - architecture §4.6 `emails.status` flows:
      - change `pending → skipped` to `processing → skipped (older than 7 days and not backfilled, reason too_old)`;
      - add `processing → pending (soft error, config error or daily cap: no count; untried claimed mail keeps its next_attempt_at)`;
      - add `processing → pending (hard error with tries left: attempts + 1, next try after 5 min)`;
      - add `processing → triaged as unsure (safety block, reason llm_blocked)`;
      - add `processing → processing (stale claim: locked_at older than 5 min, taken again by a later run; the take-back counts one attempt, and a mail that reaches 3 attempts ends as unsure / triage_error without an LLM call, stage 22)`;
      - add `skipped → pending (one-off backfill re-queue of too_old mail in the window, stage 33)`;
      - remove "pending stays pending (daily LLM cap reached …)".
    - architecture §5 data model: `emails.backfilled_at`; `audit_log` events `email.triaged`, `email.skipped`, `action.planned`, `llm.call`, `email.requeued`.
    - architecture §6.3:
      - `TRIAGE_LLM_SCOPE` (`off` / `synthetic` / `all`; `all` only for the `TEST_MAILBOX_ADDRESS` mailbox), `GEMINI_MODEL_CLASSIFIER`, `GEMINI_RPM`, `LLM_DAILY_CAP`, the LLM pause.
      - The classifier model choice (provisional from stage 34; stage 36 updates the line). The model choice goes here, not into ADR 0013 (main-session decision 2026-11-04).
      - Change "lowest thinking setting for `classifier`" to: "simple calls: no `temperature` and no thinking setting; each model uses its default thinking (`gemini-3.5-flash-lite` defaults to minimal, Google thinking page, read 2026-11-04)". ADR 0012 keeps its text (accepted).
    - architecture §9 Evals line: `--per-category`, `--retries`, resume (`evals/.runs/`), minimum support 30, confidence histogram, `--real`.
    - modules.md:
      - §2 dependency graph: add `triage --> audit` (review finding 13; the triage worker and `triage/backfill.ts` write audit rows).
      - §3.3 sender rules built; §3.4–3.6 "built in S1b" lines (worker, pause, feedback, actions `logged` rows, audit events, `requeueBackfillWindow`); `mail` gets `backfillInbox` and `mailbox:backfill`.
    - roadmap: §2 S1b row (what is done, what waits for the VPS stages); §4 script list (`eval`, `triage:label`, `triage:cost`, `rules:add`, `rules:list`, `mailbox:backfill`).
  - Test: none (docs only).
  - Check: `bunx prettier --check docs/architecture.md docs/modules.md docs/roadmap.md` (and `docs/code-patterns.md` if changed); `grep -n "lowest thinking" docs/architecture.md` prints nothing.
  - Done when: a reader can find each new config key, script, status flow and audit event in the docs.
  - Out of scope: ADR text, closing `spec/features/done/2026-11/F011-gemini-setup/plan.md` (main session decides).

- [x] **35.2 Notes and known alerts**
  - Goal: later agents find the free-tier facts and the meaning of the new alert lines.
  - Files: create `notes/2026-11-xx-gemini-free-tier-triage.md` (date of the step); change `docs/known-alerts.md`.
  - Interfaces: none.
  - Decisions:
    - The note: models tried, latency and errors seen (from the stage 18 smoke run and the stage 34 run), the limits from step 0.2, the free-tier terms facts (with the URL and the read date), the quota-day rule, and how to read `llm.call` rows (`reason_code` = outcome).
    - `docs/known-alerts.md`: one entry each for `daily LLM cap reached for mailbox …`, `LLM soft error …: triage paused …`, `LLM config error …: check GEMINI_API_KEY, GEMINI_MODEL_CLASSIFIER and the Google project …`, and `triage … no mailbox_settings row, mailbox skipped`: alert text, cause, fix, status (format of the file).
  - Test: none.
  - Check: `bunx prettier --check notes/2026-11-xx-gemini-free-tier-triage.md docs/known-alerts.md` (with the real file name).
  - Done when: the note and the four entries exist.
  - Out of scope: VPS facts (stages 37–40 append them later).

## Follow-ups from the checkpoint 2 group review (2026-11-05)

- `apps/server/src/scripts/gemini-check.ts` imports `@google/genai` (code-patterns: only `platform/llm.ts`) and logs `error.message`, which holds the HTTP error body. Rebuild it on `createLlmClient` (log `llmErrorCode`) or delete it in favour of `bun run eval --limit 1`.
- Empty `GEMINI_MODEL=` gives `""` (the classifier key falls back to the default). Record for S4, or add the same preprocess.

## Follow-ups from the checkpoint 3 group review

- Architecture §4.1 rule 7: errors outside the LLM call (thread read, save, DB) count a try in the job, with a 5-minute wait and `unsure` / `triage_error` at 3. Later claimed mail goes back with no count. Shutdown waits up to 30 s for a batch.
- Architecture §4.6: add `processing → pending` for the release of untried mail on a mailbox error (no count).
- Step 35.2 known-alerts: add `triage <mailboxId> failed: <Class>`, `triage failed: <Class>`, `triage <id>: lost the claim`, `release failed`, `triage_error save failed`, `llm.call audit write failed` (35.2 lists only four lines today).
