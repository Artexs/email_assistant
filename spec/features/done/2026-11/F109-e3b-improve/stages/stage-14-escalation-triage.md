# F109 stage 14 — Escalation in triage (conditional) `[risky]`

Part of [`../plan.md`](../plan.md). Decisions P5, P8, D15. **Build only when the stage 13 summary says `Decision: ship`.** Else the coordinator marks this stage skipped in `plan.md` § Log. Needs stages 10, 12, 13. Review before the land. No real LLM run (fake LLM in tests).

## Step 1 — Second call in `triageOne`

**Goal.** With the flag `escalation` on, a mail that `shouldEscalate` selects gets a stronger second opinion before its plan.

**Files.** The triage service; flag `escalation` in the core registry (default off, epic `E3b`, remove-by `2027-03-01`, "A stronger model checks a person's mail before the system files it away from the inbox.").

**Decisions.**

- Conditions: flag on, and `LLM_ESCALATION_MODEL` set (no fallback to the classifier model). Flag on without it → no second call, one `warn` line `escalation_unconfigured` per process start.
- Signals: `noreply` from the hard rules; `isList`, `autoSubmitted`, `precedence` from the mail's `email_headers` row (no row → `isList` false, nulls).
- The second call uses role `escalation`, prompt `escalation-v1`, the same input and `extras` as the first call. The whole second analysis wins: category (through `decideCategory`), confidence, reason, reason code, summary, fields and the delegation input (`delegationInputOf(second)`). The suspicious-mail effect of stage 03 runs on this final category (review N12).
- Stored: `triage_results.model`, `prompt_version`, `tokens_in`, `tokens_out`, `latency_ms` of the second call; `fields.escalation` = `escalationRecord(first)`. Each call writes its own `llm.call` audit row (M7 counts both).
- Daily cap: checked again before the second call. At the cap the mail goes back to `pending` with `next_attempt_at` = the next quota day, no count, no row (rejected: keep the first answer; that hides a person's mail without the check).
- Errors of the second call (soft, config, hard, `llm_blocked`) never trip the process-wide LLM pause and are not retried: the mail ends at once as `unsure` with reason code `escalation_error` (its `llm.call` row holds the error code; the digest text for the code says the AI check failed, en and pl), so other triage goes on (review N3: a bad `LLM_ESCALATION_MODEL` would else pause all triage and burn the daily cap). One `warn` line `escalation_error` per process and error code, naming the `LLM_ESCALATION_*` keys. Rejected: keep the first answer (hides a person's mail without the check).
- Crash before `saveTriage`: nothing is stored; both calls repeat after the claim is taken back (accepted).
- Share guard (review N14): when more than 40% of a mailbox's triaged mail of the quota day was escalated after at least 50 mails, one `warn` line `escalation_share_high` per mailbox and quota day (counts only). The weekly M7 shows the cost.

**Test (integration, a fake LLM that answers per role).**

1. Flag on, model set, first answer `spam` for a person mail, second `needs_reply` → final `needs_reply`, `prompt_version` `escalation-v1`, `fields.escalation.fromCategory` `spam`, two `llm.call` rows (roles `classifier`, `escalation`).
2. Flag off → one call, today's result.
3. A list mail (`List-Id` in `email_headers`) answered `notification` → one call.
4. Second call soft error → `unsure` with `escalation_error`, the pause not tripped, the next mail of the batch triaged.
5. Second call config error (404) on three mails in a row → three `unsure` rows, one `warn` line, no pause, the daily cap counts 6 calls.
5a. Second answer `delegation` with delegate id `d1` after a first `spam` → a delegation row for `d1`; with the flag `suspicious_mail` on and a look-alike sender → no row.
6. Cap reached after the first call → mail `pending`, `next_attempt_at` = next quota day, no row.
7. Flag on, `LLM_ESCALATION_MODEL` empty → one call, one `escalation_unconfigured` warn line for two mails.
8. Mailbox in `shadow` mode → the second call happens; plan `logged`.
9. An `urgent` first answer → one call.

**Check.** The triage tests, then the Proof.

**Done when.** Tests 1–9 (with 5a) pass, plus 10: 51 triaged mails, 21 escalated → one `escalation_share_high` line; for each guard (flag, model check, trigger) the worker removes it, sees its test fail, restores it; Proof `PROOF_OK`.

**Out of scope.** Owner step O2 (set `LLM_ESCALATION_MODEL=gpt-6.1-terra` and `LLM_ESCALATION_REASONING=none` on the VPS, so production matches the gate file; review N13), turning the flag on (O3), the eval path (stage 12).
