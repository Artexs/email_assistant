# F121 stage 02: ledger gaps for the coordinator to file

The worker did not edit `docs/legal/claims.md`.

## Row C032 says too little and is false as worded

- Ledger text: "The assistant does not send mail older than 7 days, unless the operator loads old mail once (a backfill)." Source: `docs/capabilities/triage.md` rule 2, `docs/capabilities/sync.md` rule 15.
- What the code does: rule 2 of `triage.md` skips a mail older than 7 days (`too_old`). That is the mail that the assistant classifies. The same call also sends up to three earlier mails of the same thread as context. Those have no age limit: `listThreadContext` in `apps/server/src/modules/mail/repo/lookup.ts` filters only on `received_at < before`. `apps/server/src/modules/triage/classify-input.ts` and the prompt `classifier-v2` put them into the prompt.
- What each context mail carries: sender, subject, received time and `left(body_text, 500)` (up to 500 characters of the body).
- Fix for the ledger (coordinator or the F107 owner): reword C032 to "The assistant does not classify a mail older than 7 days, unless the operator loads old mail once." Add a row for the context: "For each classified mail the assistant also sends the sender, the subject and up to 500 characters of the body of up to three earlier mails of the same thread; these mails have no age limit." Source: `apps/server/src/modules/mail/repo/lookup.ts` (`listThreadContext`), `docs/capabilities/triage.md` rule 3.
- Row C031 ("up to three earlier mails of the same thread as context") is true but does not say what each context mail carries, nor that the 7-day limit does not apply to them. The same applies to C193 and C201 ("Mail older than 7 days is not sent to the LLM"): the same false wording in the DPIA draft and may need the same fix. The privacy and DPA papers may carry the same wording.
- Effect on the public page: the claim `ai-provider-receives` cites C030, C031 and C032. Its text states only what the code and `triage.md` rule 2 prove. The context facts (no age limit, 500 characters) stand in "What this product does not promise" because no ledger row says them. When the ledger has the new row, move that sentence into the claim and cite the row.
