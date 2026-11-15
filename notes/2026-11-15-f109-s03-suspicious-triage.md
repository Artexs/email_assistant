# F109 stage 03: suspicious reasons in triage (decisions and limits)

Code: `apps/server/src/modules/triage/suspicious-context.ts` (loader, `assessEmail`), `suspicious-repo.ts` (two queries), `service.ts`, `jobs.ts`.
Test: `apps/server/test/integration/triage-suspicious.test.ts` (stage tests 1-9 plus extra cases, all through `createTriageJob`).

## Rules as built

- Context is read once per claimed batch in `jobs.ts` (after the claim, before the loop). A mailbox with no claimed mail reads nothing.
- Known address: mailbox addresses of the organization, active delegates, exact `whitelist` and `vip` rules, and frequent senders.
- Known by domain: domains of mailbox addresses, delegates and `@domain` whitelist/vip rules, never a `freeMailDomains` entry.
- `knownDomains`: domains of known addresses and domain rules. A frequent sender adds no domain (test 6f, two senders in one batch).
- Frequent sender (N1, N15): 3 or more mails in this mailbox in 90 days, each with a newest `triage_results` row that is not `spam` and has `suspicious_reasons = '{}'`. Query: `emails.from_address_lower = ANY(...)` (stage 02 column and index), `org_id` and `mailbox_id` on every query.
  - N15: the stage text was followed. It counts mails, each mail on its own newest category. "3 spam then 1 info" is not known (test 6b). D4 and the stage text agree under this reading.
  - N1: flagged mail never counts (test 6c: 3 flagged info mails, the 4th is still flagged).
- The frequency count is read at batch start. Mail of the same batch does not count for its siblings.
- `protectedNames`: delegate names, organization member `display_name`, newest non-empty `email_headers.from_name` of each exact VIP address (this mailbox, 90 days).
- `trustedAuthservIds`: registrable domain of the mailbox IMAP host plus `MAIL_TRUSTED_AUTHSERV_IDS` (lower case, comma list; `.env.example`).
- Reasons are computed before the cap check and the LLM call, for the blocklist path, the classify path and the `llm_blocked` save. `finishTriageError` stores `{}` (no headers read).
- Flag `suspicious_mail` (default off, epic E3b, remove-by 2027-03-01): reasons not empty, final category `delegation`, flag on: delegation input is null, so the plan is empty. Category and INBOX place stay.
- `email.triaged` audit data: `suspicious` is a comma list of codes (`AuditData` is flat); empty string when none.

## Accepted limits (stage 16 puts these in the capability page)

- N16: mail that forges an own mailbox address, a delegate address, or any address on an organization domain counts as known. Only `auth_fail` catches it, and only when a trusted `Authentication-Results` header exists (test 6g).
- `protectedNames` holds delegates, members and VIP display names. A CEO who is none of these is not protected.
- Old `triage_results` rows (before stage 02) read as `{}`. They count as "clean" for the frequency rule. A phisher with 3 old non-spam mails is known. No fix planned: the window is 90 days.
- Error path (`finishTriageError`, 3 failed tries) stores `{}`.

## Mutation checks (each alone, logs in /tmp/f109-s03/mut-*.log)

Each guard removed fails its test: flag, known check, clean-reasons filter, non-spam filter, mailbox scope, 90-day window, `from_address_lower` (exact `from_address` fails 6a), frequent domains in `knownDomains`, IMAP host trust, free-mail exception, member, VIP and delegate names, mailbox addresses, blocklist rule skip, reasons insert, VIP-name org+mailbox scope (9c).
Equivalent mutants (no test can fail): dropping only `e.org_id` in the frequency query, or only `tr.org_id` in its lateral join. `mailbox_id` and `email_id` are unique ids, so the organization follows from them.
