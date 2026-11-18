# F120 · Questions and owner steps

No blocking question. Each item has the default the plan uses. The coordinator copies the `[important]` items to `docs/owner-decisions.md` when it lands the plan.

## Defaults (owner to confirm)

- **Q1** [important: user-visible] Sender line in Telegram cards? Default: **no**, panel only (Activity, Approvals) (P2). Reason: the per-user Telegram detail level of ADR 0032 is not built; strict outbox views make a rollback harder. Other option: add it to the approval card at `full` detail.
- **Q2** [important: privacy] The privacy page and the records of processing must name the sender profiles. Default: the data category is added in stage 02; the page text change and any `TERMS_VERSION` bump are batched with the next legal change (as F110). Stage 12 gives the sentence. Other option: a legal change in F120 itself.
- **Q3** [important: production] Pilot flags. Default: the coordinator turns on `sender_context` at deploy and `contact_wait` one day later; `sender_suggestions` waits for the owner's word (it is the visible part). Other option: all three wait for the owner. Known domains (D9) also need `suspicious_mail`, which stays off by the F109 owner decision; when the owner turns it on, D9 adds look-alike reasons, and those reasons block drafts and follow-ups (the readers ignore the flag).
- **Q4** [important: production] If stage 11 shows that `classifier-v4[profile]` wins the dev and holdout rules: switch the production prompt? Default: **no switch** until the owner says so (as owner decision 42 for v3). The coordinator asks once, with the five rule lines.
- **Q5** [important: privacy] A DSR erase of `anna@acme.pl` does not delete a domain suggestion `@acme.pl` (it names a domain, not the person). Default: keep. Other option: delete every suggestion of the person's domain too.
- **Q6** [important: money] LLM spend of stage 11: cap $1.50 (dev ≤ $1.10, holdout ≤ $0.40), from the lab budget ($20 a month). Default: yes.
- **Q7** [important: privacy] With a flag turned off, the stored profiles stay and age out after 12 months (retention runs whatever the flags say). Default: keep. Other option: delete all profiles of the org when `sender_context` goes off.
- **Q8** [minor] Domain rows are not stored; domain aggregates live in memory for suggestions (D2). This amends ADR 0034 point 1 (fewer stored rows).
- **Q9** [minor] Key = HMAC with a key derived from `CREDENTIALS_KEY` and the org id in the message (D3); no new secret. A key change orphans rows until retention.
- **Q10** [minor] The contact wait wins over the owner's `loop_wait_days` when the contact has ≥ 5 reply samples (P5).
- **Q11** [minor] Suggestion details (D10): domain suggestions only for whitelist and blocklist and only with ≥ 2 senders of the domain; whitelist and blocklist both true → neither; order under the cap: whitelist, VIP, blocklist; VIP and whitelist never for a sender with a suspicious mail.
- **Q12** [minor] A member sees the Suggestions card read-only; only an owner taps Accept or Dismiss (P3), as for sender rules.
- **Q13** [minor] Known domains (D9) only widen the look-alike list (≥ 2 user mails, no domain with suspicious mail); the "known sender" rule does not change.
- **Q14** [minor] Without Sent coverage (D16: `sent_sync` off, switch off, or no first pass) no blocklist suggestion is made, because "never wrote to them" cannot be known. The first Sent pass stores 30 days only, so for the first 60 days "never wrote in 90 days" means "never wrote since the Sent history starts".
- **Q15** [minor] Bulk relation uses only mail whose list headers are not cleared yet (D17); with a short `data_retention_days` a rare newsletter can read as `new`.

## Owner steps

- After stage 02 lands: `bun run db:migrate` on the shared dev DB (the coordinator tells the owner; no agent runs it).
- After stage 11: Q4, only on a win.
- After stage 13: turn on `sender_suggestions` for the pilot org, or tell the coordinator to do it (Q3).

## Gates

- Build after F100 (done), F104 and F110 in `done/` (their last stages are the VPS steps; the code F120 reads is on `master`).
- Stage 13 waits for the F104 and F110 VPS stages.
