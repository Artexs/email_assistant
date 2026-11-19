# F104 stage 11 review (Opus 5.5, PASS 66ab9965)

Model: Opus 5.5, because the stage holds a migration and a message to people. No BLOCKING.

Test gaps (fixed in a Sonnet continue, no re-review):
- TG1: per-mailbox health lookup weakly tested (mutation `health.get(mailbox.id)` -> first row survived). The two-mailbox test must assert each key and `since`.
- TG2: "each queue in its own try" has no test (`warnSkipped` -> `throw` survived).
- TG3 (harmless): removing the `st.org_id` filter in `listSentHealth` survives the notice tests; the detector looks rows up by mailbox id. The stage 07 reader test covers the filter.
- TG4: no automated test runs the down migration with a `sent_missing` row present. Proven by hand: the real down deletes the row and passes.

Notes:
- N1: the OLD release with the new CHECK. Old `noticeKinds` lacks `sent_missing`: `claimDueOutbox` sets the batch to `sending`, then `noticeKindSchema.parse` throws a ZodError. The sender logs `outbox_claim_failed`, the row stays `sending`, and the other rows of that batch (all orgs) are held until stale. Same risk as every earlier kind. Nil while `sent_sync` is off for non-lab orgs. Stage 13 runbook: before an image rollback past this stage run `UPDATE outbox SET status='failed', error_code='outdated', locked_at=NULL WHERE kind='sent_missing' AND status IN ('pending','sending')`. Do not use `db:rollback` on the VPS.
- N2: `docs/capabilities/sent-mail.md` rule 13 said sent mail "goes to no LLM and no Telegram chat yet": reworded in the fix.
- N3: `since` can equal the INTERNALDATE of a sent mail that the sent DSR later erases. It is only a time: acceptable.
- Consent: NO bump (the consent text names the mailbox addresses; the view holds one time only).
- The dropped stale-pass guard is dead code (proven by logic); review-8 N3 holds through test 9b (7-day rule).
- The int run had 3 transient ENOSPC failures in /tmp (not the stage).
