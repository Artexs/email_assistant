# F120 stage 10 — Known domains for the look-alike rule [risky]

Part of [`../plan.md`](../plan.md). Decision D9, PD-063. `[risky]`: it changes which mail gets a suspicious reason, and suspicious reasons block drafts and follow-ups whatever the flag `suspicious_mail` says.

Carry-over reads: `docs/capabilities/triage.md` rule 17 (`lookalike_domain`, known sender, readers that ignore the flag), `apps/server/src/modules/triage/suspicious-context.ts` (`loadSuspiciousContext`, `knownDomains`), `packages/core/src/triage/suspicious.ts` (`freeMailDomains`, `registrableDomain`, `isLookalike`), `docs/capabilities/sent-mail.md`.

## Step 1 — the domain list

- Goal: only when both `sender_context` and `suspicious_mail` are on for the org, `loadSuspiciousContext` adds to `knownDomains` the registrable domains that meet all of:
  - To or Cc of at least 2 `origin = 'user'` `sent_emails` rows of the mailbox with `sent_at` in the last 90 days (real mail only; null or cleared values ignored);
  - not in `freeMailDomains`;
  - no incoming mail of the mailbox from that registrable domain in the last 90 days has a newest `triage_results` row with suspicious reasons (so one reply to a phisher does not make the phishing domain known).
- At most 500 domains, most user mails first. One statement per batch context (no per-mail query).
- The reader lives in `mail` (it owns `sent_emails`): `sentRecipientDomains(db, ctx, mailboxId, { since, minMails, limit }) : Promise<{ domain: string; mails: number }[]>` (lower-case host parts; triage applies `registrableDomain` and the suspicious filter through its own reader).
- The "known sender" rule does NOT change: a domain the user wrote to makes look-alikes of it suspicious; it does not silence checks on mail from that domain.
- With either flag off the context is as before, byte for byte.

## Test

Integration (`triage-known-domains.test.ts`), both flags on unless said:
1. Two Sent mails to `jan@kontrahent.pl`; incoming mail from `jan@kontrahemt.pl` (one edit) → `lookalike_domain` in the reasons.
2. Same with `suspicious_mail` off → no `lookalike_domain`; same with `sender_context` off → none.
3. Only one Sent mail to `kontrahent.pl` → not known → no `lookalike_domain` for test 1's mail.
4. Reply to a look-alike (with the Sent mails of test 1): incoming mail from `x@kontrahemt.pl` stored with reason `lookalike_domain`; the user then writes twice to `x@kontrahemt.pl` → `kontrahemt.pl` is not added; a later mail from `kontrahemt.pl` still gets `lookalike_domain`.
5. Sent mail to `x@gmail.com` twice → `gmail.com` not in the list.
6. Sent mail 91 days old → not counted; `origin = 'system'` → not counted.
7. Org B Sent rows → not in org A's list.
8. Incoming mail from `jan@kontrahent.pl` itself → no `lookalike_domain`.

## Done when

All tests pass; mutations: drop the `origin = 'user'` filter → test 6 fails; drop the suspicious filter → test 4 fails. Then the Proof command.

Out of scope: the sim suspicious-mail eval (plan.md § Not verified).
