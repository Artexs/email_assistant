# s1b-shadow-triage — Stage 38

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.
Shell setup, preconditions and the SQL queries (Q1–QH) are in [`vps-shared.md`](vps-shared.md).

## Stage 38 — VPS: real-mail shadow week [risky]

- [ ] **38.1 One week of real mail in shadow mode (free tier, pilot mailbox only, ADR 0013)**
  - Goal: one week of the pilot's real mail is triaged in shadow mode, and the user labels it.
  - Files: this task file (log lines: start time, daily checks, counts); the free-tier note from step 35.2 (append: pause and quota events seen, no mail data).
  - Interfaces: none (operations).
  - Decisions: the stage 39 trigger is the count of real _mails_ (QA `real_mails`), not the label count (review finding 11, user answer 3).
  - Steps:
    1. The user sets `TRIAGE_LLM_SCOPE=all` in the VPS `.env` (`TEST_MAILBOX_ADDRESS` is already the pilot address). `$C up -d --force-recreate --wait server`. `$C logs --since 5m server` shows the `warn` "triage sends the real mail of the TEST_MAILBOX_ADDRESS mailbox to Gemini (TRIAGE_LLM_SCOPE=all)". Write the start time `<START>` (UTC) in the log.
    2. Real mail older than 7 days (stored by the S1a rescan) goes to `skipped` / `too_old` (QE shows how many; stage 39 re-queues them). The rest of the backlog goes first, oldest first, up to `LLM_DAILY_CAP` per Los Angeles day.
    3. After 1 hour: Q4 and the log grep of step 37.1. A config error (any `http_4xx` code) → the user sets `TRIAGE_LLM_SCOPE=off`, `$C up -d --force-recreate --wait server`, and the main session reports.
    4. During the week the user labels with `$C run --rm server bun run triage:label --org-id <ORG> --mailbox-id <MB>` (no `-T`: the prompt needs a TTY), for example once a day. Do not run evals on the same project unless the quota left covers them (the stage 36 Flash-Lite subset, 18–36 requests, is fine).
    5. At `<START>` + 7 days: run the checks.
  - Test: none (operations).
  - Check: QA `week_ok` = `t`; QC = 0; QD `missing` = 0; QA `real_mails`, QB and QE written in the log.
  - Done when: the checks pass, and the next stage is chosen:
    - QB ≥ 100 → skip stage 39, go to stage 40.
    - QA `real_mails` ≥ 100 and QB < 100 → the user labels more of the week's mail until QB ≥ 100 (no backfill), then stage 40.
    - QA `real_mails` < 100 → stage 39.
  - Out of scope: the backfill, a change of the cap, a prompt or model change (needs an eval first, code-patterns), any mailbox write.
