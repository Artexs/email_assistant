# F110 stage 22: unsubscribe data (notes for stages 23 to 25)

- Migration `20261117140001_unsubscribe_data.sql`: `email_headers.list_unsubscribe_post boolean` (null on old rows) and table `unsubscribe_requests`. Expand only, no contract line. U1: the owner runs `bun run db:migrate` on the shared dev DB after the land.
- `code` has a CHECK `^[a-z0-9_]{1,40}$`: it can never hold a URL. `sender_domain` must be the end of `sender_lower` (CHECK). Both columns are lower case (CHECK).
- DSR: new rule `delete` in `DSR_ADDRESS_MAP` (`unsubscribe_requests.sender_lower`): the erase deletes the row. `sender_domain` is in `NOT_PERSONAL` (a domain is not an address; the row goes with the sender). Data category `unsubscribe-data`, kept until delete.
- Readers live in `triage`, not `trust`: a `trust` source may not name `triage_results` (test in `trust-history-job.test.ts`). `listNewsletterSenders(db, ctx, mailboxId, now, { trustedAuthservIds })` and `suspiciousSendersOf(db, ctx, mailboxId, sendersLower, since)`.
- Deviations from the stage text (each a type 2 decision, all on the safe side):
  - `suspiciousSendersOf` takes `since` (the reader has no clock; same as `listFrequentSenders`).
  - `listNewsletterSenders` takes `{ trustedAuthservIds }` and uses only `MAIL_TRUSTED_AUTHSERV_IDS`, not the IMAP host that F109 adds. With the variable unset, no sender is `oneClick`. Stage 23 can add the host later if the owner wants it.
  - The result has no `spam` field: a spam or suspicious sender is left out, so the value would always be false.
  - A sender is listed only when EVERY mail of the window that has a result is `info` or `notification` (an `urgent`, `needs_reply`, `unsure` or `spam` mail leaves the sender out).
  - `dkim=pass` counts for `header.d` equal to the From domain or a parent of it down to the registrable domain (`hasTrustedAlignedDkimPass`, `packages/core/src/triage/dkim-pass.ts`). It does not prove that the signature covers the `List-Unsubscribe` headers (question 16; stage 25 writes the limit).
- Never fetch: `triage-newsletter-senders.test.ts` test 12 stubs `fetch` and scans the module for HTTP imports.
- Proof logs of the job were in `/tmp/f110-s22/` (copied to the job folder `.limen/jobs/<id>/f110-s22-logs/`).
