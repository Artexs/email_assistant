# F120 stage 10 — Known domains for the look-alike rule

Part of [`../plan.md`](../plan.md). Decision D9, PD-063.

Carry-over reads: `docs/capabilities/triage.md` rule 17 (`lookalike_domain`, known sender), `apps/server/src/modules/triage/suspicious-context.ts` (`loadSuspiciousContext`, `knownDomains`), `packages/core/src/triage/suspicious.ts` (`freeMailDomains`, `registrableDomain`), `docs/capabilities/sent-mail.md` (Sent rows, `origin`).

## Step 1 — the domain list

- Goal: with `sender_context` on, `loadSuspiciousContext` adds to `knownDomains` the registrable domains of To and Cc of `origin = 'user'` `sent_emails` rows of the mailbox with `sent_at` in the last 90 days (real mail only), minus `freeMailDomains`, minus the empty or null values that retention left. The read is one statement in the batch context (no per-mail query). At most 500 domains, most mails first.
- The reader lives in `mail` (it owns `sent_emails`) and is exported from its index: `sentRecipientDomains(db, ctx, mailboxId, { since, limit }) : Promise<string[]>` (lower case, registrable domain applied by the caller in triage).
- The "known sender" rule (who gets only `auth_fail` and `risky_attachment`) does NOT change: a domain the user wrote to makes look-alikes of it suspicious, it does not silence checks on mail from that domain. Reason: a known-sender widening would weaken the phishing check, and no eval covers it.
- With the flag off the context is as before (byte for byte).
- Cost: one more query per batch only with the flag on; the capability page states it (stage 12).

## Test

- Integration (`triage-known-domains.test.ts`):
  1. Sent mail to `jan@kontrahent.pl`, flag on; incoming mail from `jan@kontrahemt.pl` (one edit) → `lookalike_domain` in the reasons.
  2. Same, flag off → no `lookalike_domain` (the domain is not known by other rules).
  3. Sent mail to `x@gmail.com` → `gmail.com` not in the list (free mail).
  4. Sent mail 91 days old → not in the list.
  5. Sent mail with `origin = 'system'` → not in the list.
  6. Org B Sent rows → not in org A's list.
  7. Incoming mail from `jan@kontrahent.pl` itself → no `lookalike_domain`.
- Unit: none new (the look-alike compare exists).

## Done when

All tests pass; mutation: drop the `origin = 'user'` filter → test 5 fails. Then the Proof command.

Out of scope: the sim suspicious-mail eval (the sim has no Sent history for the phishing persona; recorded as not verified in plan.md).
