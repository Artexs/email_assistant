# F109 stage 14 — Escalation in triage (conditional) `[risky]`

Part of [`../plan.md`](../plan.md). Decisions P5, P8, D15. **Build only when the stage 13 summary says `Decision: ship`.** Else the coordinator marks this stage skipped in `plan.md` § Log. Needs stages 10, 12, 13. Review before the land. No real LLM run (fake LLM in tests).

## Step 1 — Second call in `triageOne`

**Goal.** For an organization with the flag `escalation` on, a mail that `shouldEscalate` selects gets a second, stronger opinion before its plan is made.

**Files.** The triage service (never next to stages 03 or 10); flag `escalation` in `packages/core/src/features.ts` (default off, epic `E3b`, remove-by `2027-03-01`, description "A stronger model checks a person's mail before the system files it away from the inbox.").

**Decisions.**

- Conditions: flag on for the organization, and `LLM_ESCALATION_MODEL` set (the role row must not fall back to the classifier model). Flag on without the model → no second call and one `warn` line `escalation_unconfigured` per process start.
- Signals: `noreply` from the hard rules; `isList`, `autoSubmitted`, `precedence` from the mail's `email_headers` row (no row → `isList` false, nulls).
- The second call uses role `escalation`, prompt `escalation-v1`, the same input and `extras` as the first call. Its answer passes `decideCategory` and wins.
- Stored: `triage_results.model`, `prompt_version`, `tokens_in`, `tokens_out`, `latency_ms` of the second call; `fields.escalation` = `escalationRecord(first)`. Each call writes its own `llm.call` audit row (M7 counts both).
- Mode and `auto` do not matter (D15).
- Daily cap: checked again before the second call. At the cap the mail goes back to `pending` with `next_attempt_at` = the next quota day, no count, no row (rejected: keep the first answer; that hides a person's mail without the check).
- Errors of the second call follow triage rule 7 as for the first call: soft or config error → pause, the mail back to `pending` without a count, no row (both calls repeat later); hard error → `attempts` + 1, no row; `llm_blocked` → `unsure` at once.
- Crash between the two calls or before `saveTriage`: nothing is stored; the claim is taken back later and both calls repeat (one extra first call; accepted).

**Test (integration, a fake LLM that answers per role).**

1. Flag on, model set, first answer `spam` for a person mail, second `needs_reply` → final `needs_reply`, `prompt_version` `escalation-v1`, `fields.escalation.fromCategory` `spam`, two `llm.call` rows (roles `classifier`, `escalation`).
2. Flag off → one call, today's result.
3. A list mail (`List-Id` in `email_headers`) answered `notification` → one call.
4. Second call soft error → no row, mail `pending` without a count, pause tripped; the next run makes both calls and stores the result.
5. Second call hard error → `attempts` 1, no row.
6. Cap reached after the first call → mail `pending`, `next_attempt_at` = next quota day, no row.
7. Flag on, `LLM_ESCALATION_MODEL` empty → one call, one `escalation_unconfigured` warn line for two mails.
8. Mailbox in `shadow` mode → the second call happens; plan `logged`.
9. An `urgent` first answer → one call.

**Check.** The new tests and the triage job tests, then the Proof.

**Done when.** Tests 1–9 pass; for each guard (flag, model check, trigger) the worker removes it, sees its test fail, restores it; Proof `PROOF_OK`.

**Out of scope.** Owner step O2 (set `LLM_ESCALATION_MODEL` on the VPS), turning the flag on (O3), the eval path (stage 12).
