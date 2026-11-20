# F151 plan review 1 — response

Review: [`plan-review-1.md`](plan-review-1.md) (claude-opus-5-5, high; verdict FAIL at `b6d85180`). One blocking finding, 12 findings, 8 notes. All accepted; none rejected.

| Finding | Change |
| --- | --- |
| B1 delegation plans nothing without `task` | Stage 01 replays `reason`, `summary` and `fields` from the seed row; test 5 asserts `fields.task`. Stage 02 picks a delegation mail only with `task` set. Plan D2. |
| F1 rule rows fail the schema | Stage 01: a rule or error row gives no entry (`ruleRows`), test 5b. Stage 02 candidates need a table entry. |
| F2 undo ignores the gate threshold | Stage 02: undo pick ≥ the gate threshold of its category; other picks ≥ 0.7; `recommended` carries thresholds; v2-shaped test 1b. Plan D5. |
| F3 Playwright timeout below the wait budget | Stage 04: `DEMO_WAIT_LIMITS_MS` and `demoTestTimeoutMs()` (test 4: 1,616,000 ms). Plan D7. |
| F4 SMTP history mail is triaged as new | Stage 05: delivery by IMAP APPEND with internal dates; history newest at now − 2 days. Plan D5. GreenMail keeping the internal date is in Not verified (stage 05 proof run shows it). |
| F5 step 7 preconditions | Stage 02: overdue path only when A's seed settings are assist with `create_draft` on (test 11). Stage 06: wait `delegationSent` before the fallback. Plan D8. |
| F6 empty reason or summary | Covered by B1 (reason, summary replayed). |
| F7 no test that the server uses the copy | Stage 04 test 3 runs `loadGateEvidence` and `runningEvidenceKey` on the demo env. Stage 02: file choice by the `evidence.ts` rank; `fileName` starts `classifier-`; key fields from the running-key builder. |
| F8 guard checks only the host | Stage 04: `assertLoopbackLlm` checks every role row (provider, endpoint, host); deepseek case in test 2. |
| F9 acceptance 2 not proven | Stage 06: `demo_llm_checked` from the server's `llm_settings` lines and the hit count; `demo_replay_unused` in stage 04. |
| F10 sync cadence from `.env` | Stage 04: `MAIL_SYNC_EVERY_MIN=2` in `demoServerEnv`. |
| F11 re-gate notices in the chat | Stage 05 setup turns `auto` off on A before the Telegram link; stage 06 allows the other product notices (trust report, approval card). Q5 updated. |
| F12 delegate line with tags | Stage 01 test 5 covers both line forms. |
| N1 verdict vs exit | Stage 06: the verdict prints before the stage-04 exits; it never changes the exit code. |
| N2 e2e video and the cut | Stage 03 goal says the cut applies to both sources. |
| N3 stage 04 never runs | Split: stage 04 command and env (pure tests); new stage 05 setup with a `--setup-only` run on the export; the recording is stage 06. Seven stages. |
| N4 C1 precondition | Plan C1: the sim run must use the production classifier setup. Coordinator edit in the final message. |
| N5 candidate edge cases | Stage 02: null sender or subject, and sender A or B, are never picked (test 9). |
| N6 `create_draft` off by default | Decision in D6 and stage 06 step 4 (removed from Not verified). |
| N7 `language` has no empty value | Stage 01: `language` from the seed row, else `other`. |
