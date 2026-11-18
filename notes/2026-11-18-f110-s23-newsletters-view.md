# F110 stage 23: newsletters view (notes for stages 24 and 25)

- Route `GET /api/newsletters/:mailboxId` (flag `bulk_unsubscribe`, any member) lives in `triage`: `newsletter-routes.ts`, `newsletter-view.ts`, docs in `api-docs.ts` (`newsletterDocs`), schema `packages/core/src/web/newsletters.ts`. Mounted in `web.ts` with `mailTrustedAuthservIds(config)` (`MAIL_TRUSTED_AUTHSERV_IDS` only).
- Item: `{ senderLower, fromName, count, latestAt, method, request, linkUrl? }`. `method`: `one_click` (the D17 rule of `listNewsletterSenders`), else `link` (an offered `https` link), else `none`. `request` is `{ status, at }` from `unsubscribe_requests` (`at` = `finished_at` or `created_at`).
- Deviations from the stage text (type 2, safe side):
  - `linkUrl` is for the owner only. It is present for `link`, and for `one_click` once a request exists (the page is the way out of a failed or lost request). A member never gets a link.
  - `NewsletterSender` has a new field `linkUrl` (the first usable `https` URI, parsed form `URL.href`). A URI with a user name or password is not offered. The stored header has at most 1000 characters (CHECK in `email_headers`), so no length cap is needed. `hasHttpsUnsubscribeLink` now calls `firstHttpsUnsubscribeUrl`.
  - `fromName` is attacker text: the API cuts it to 100 code points, and the panel shows `senderLower` as the identity and the name small, as plain text (review 22 NOTE 4).
- Stage 24 must: add the button for a `one_click` row without a request (`NewslettersCard.tsx` has a comment at the place; `actionOf` in `lib/newsletters-view.ts` returns `wait` for it), re-read the sender with `listNewsletterSenders`, and keep `linkUrl` out of logs and audit rows.
- The card is on the Rules page (below the urgency card), with its own mailbox select. No new tab, so the phone tab bar is unchanged.
- E2E: seed org per project `E2E Newsletters <project>` (`e2e-newsletter-rows.ts`); `apps/web/e2e/env.ts` sets `MAIL_TRUSTED_AUTHSERV_IDS=mx.e2e.test` for the e2e server.
- Playwright file filters match the full path: a worktree path that contains `newsletters` made the filter `newsletters` select all 324 tests. Use `tests/<name>.spec.ts`.
- Open (not done here): review 22 NOTE 5 (the 200 cap applies in JS after a full SQL read; a LIMIT would change which senders show after the spam filter: left as is), NOTE 7 (add `members` to the subject list of the data category `unsubscribe-data`: a legal text change, so a possible `TERMS_VERSION` bump: left to the owner).
- The `org_id` filter of the request read in `newsletter-view.ts` has no killing test: the composite FK `(mailbox_id, org_id)` makes a row with a foreign org and an own mailbox impossible, and the `mailbox_id` filter is tested. It stays as the rule "org_id on every query".
