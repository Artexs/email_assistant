# Sender context

> Checked against the code at `8a9a834c`, 2026-11-19.

## What it does now

The assistant keeps a count-only profile of each sender of a mailbox: mails, answers, corrections and reply times. The key is a keyed hash, there is no mail text, and a profile is deleted 12 months after the last mail. Four readers use the profiles, each behind its own flag. The Rules page shows VIP, whitelist and blocklist suggestions with a reason of counts. Activity and Approvals show one sender line. An open loop waits as long as its contact usually takes to reply. The look-alike rule of the suspicious-mail checks learns the domains that the user writes to. A fifth reader, the profile line of the classifier prompt (`classifier-v4`), lost its dev runs and is not in production. All of it is off by default (three flags, epic `E11a`). Telegram shows no sender line.

## Rules

1. **Flags (ADR 0027).** `sender_context` (the pass, the sender line, every reader of the profiles), `sender_suggestions` and `contact_wait`. Default off, epic `E11a`, remove-by 2027-06-01. The last two count as off unless `sender_context` is on (`senderFlags`, `modules/contacts/flags.ts`: a reader of the profiles asks there, never `isFeatureOn` alone). The Sent domains for the look-alike rule need `sender_context` and `suspicious_mail` (rule 13). Retention and the data-request erase run whatever the flags say: a switched-off org keeps its profiles until they age out (question Q7 of the plan: kept). Order to turn them on: `deploy/README.md` § Sender context.
2. **The profile pass.** The job `contacts.refresh` runs hourly at minute 7 (`0 7 * * * *`), needs no model (it runs with the triage scope `off`), and gates itself: only `active` mailboxes of organizations that are not suspended; the flag is read per organization. `refreshMailboxProfiles` recomputes every row of a mailbox from the stored mail of the last 90 days in one transaction (a derived snapshot, ADR 0034; no increments). Keys: the senders of incoming mail and the To and Cc addresses of `origin = user` Sent mail. Real mail only (test mail is left out), and the own addresses of the mailbox get no row. Counts: `received`, `answered` and `flagged` (from `email_flags`), `moved_back`, `unseen_7d`, `user_mails_to`, `delegations_to`, `by_category` (newest `triage_results` category per mail), `corrections` (newest `wrong` feedback per mail, by `true_category`). Reply delays: the user delay where the Sent `parent_message_id` equals the incoming `message_id_header`; their delay where the Sent `message_id` is one of the ids in the incoming `in_reply_to` (whole-id compare). A delay of 0 or less is dropped; a median needs 5 samples (`reply_samples_theirs` keeps the count). A row that is absent from the window keeps its dates and gets counts of 0. A pass writes only rows whose values changed (an unchanged row costs no write). It skips a mailbox when another pass or a data-request erase holds the lock for it (rule 6).
3. **Relation and bulk.** `relationOf` (`packages/core/src/triage/sender-history.ts`): `delegate`, then `vip`, then `bulk` (bulk signals on more than half of the mail), then `known` (the user answered or wrote at least once), else `new`. The bulk ratio counts only mail whose captured headers are not cleared (`texts_cleared_at IS NULL`; headers clear after `data_retention_days`, 30 by default); the noreply signal counts on all mail. So with a short `data_retention_days` a rare newsletter can read as `new`.
4. **No address in the profile.** `sender_profiles.key_hash` is `senderKeyHash`: HMAC-SHA256 with a key that HKDF derives from `CREDENTIALS_KEY`, with the org id in the message (`platform/crypto.ts`). There is no new secret and no link across organizations. No column holds an address, a name, a subject or a text (a scan test checks it; the table CHECKs hold the key shape and the closed lists of the JSON keys). `sender_suggestions.pattern` holds the address or the `@domain` of a suggestion only while the row is open (at most 30 days); every end clears it. Domain aggregates live in memory for the suggestions; no domain row is stored.
5. **Retention.** `deleteOldProfiles` deletes a profile whose newest of `last_seen_at` and `last_user_mail_at` is older than 365 days. `deleteEndedSuggestions` ends open suggestions after 30 days as `expired` and deletes ended rows 90 days after their end ([retention.md](retention.md) rule 10).
6. **Privacy.** One advisory lock for each mailbox (`profileLockKey`) serializes the pass and the erase: the pass takes it with try (busy: skip), the data-request erase takes it and waits for each mailbox before it deletes, so a pass never writes back an erased row. The DSR find counts the profile and suggestion rows of the person in every mailbox of the organization (the hash is recomputed from the given address); the erase deletes them. A domain suggestion is not erased by an address erase (question Q5 of the plan). The export joins the plain address to a profile row where the organization still holds a stored address that hashes to the key (`senderAddressesOfProfiles`). Mailbox and organization delete cascade. Detail: [account-data.md](account-data.md) rules 6 and 7 to 10.
7. **Suggestions (the generator).** The pass makes suggestions for each active mailbox, after the profile write, in the same transaction. VIP: at least 5 answers in 30 days and at least 60% answered, or at least 3 flagged in 30 days; never for an own, noreply, VIP, bulk or delegate sender or one with a suspicious mail. Whitelist: at least 2 mails that the user moved back or corrected away from spam or notification in 90 days; never with a suspicious mail or a block rule. Blocklist: at least 2 mails corrected to spam in 90 days, and the user never answered or wrote to the sender, and the mailbox has Sent coverage; never for a known, delegate, VIP or whitelisted sender. A domain suggestion (whitelist or blocklist only) needs at least 2 senders that meet the rule, a registrable non-free-mail domain that is not an own mailbox domain or a shared hosting suffix, and no protected address on the domain. Both a whitelist and a blocklist signal for one address: neither. At most 3 new rows a week for a mailbox, in the order whitelist, VIP, blocklist. Sent coverage (`sentCoverage`): flag `sent_sync` on, the mailbox switch on, `first_pass_at` set, the last pass within 24 hours and with no error code. Rules in `packages/core/src/contacts/suggestions.ts` (pure); the step is `modules/contacts/suggest.ts`.
8. **Life of a suggestion.** `open` → `accepted`, `dismissed`, `withdrawn` or `expired` (30 days). The pass withdraws a row when a rule of the same kind covers it (a VIP rule covers a whitelist), a "never" condition turns true, or an open domain row of the same kind covers an address row; a ratio that drops below its threshold does not withdraw. The pattern is cleared at every end (table CHECK). Dismiss hides the key and kind for 90 days. A row that is `expired` can come back at once (the weekly cap still counts it). A mailbox that is not `active` is frozen: no new rows, an open row stays until it expires.
9. **Accept and Dismiss.** `acceptSuggestion` and `dismissSuggestion` (`suggestion-commands.ts`) lock the row `FOR UPDATE`. Accept first asks `suggestionBlockedNow` (the same check as the pass, reading only the row's address or domain): a protected sender answers `not_available` and the row ends as `withdrawn`. Then `addSenderRule` makes the rule (`added` and `exists` both end the row as `accepted`); at the rule limit the row stays open (`rule_limit`). The audit rows are `suggestion.accepted` and `suggestion.dismissed` (data: mailbox, kind, scope, `via`; never the pattern or the key) and the normal `rule.added`.
10. **Routes, card and weekly line.** `GET /api/suggestions/:mailboxId` (member, newest first), `POST /api/suggestions/:id/accept` and `/dismiss` (owner, body `{}`). With `sender_suggestions` or `sender_context` off every route is 404 for every role. Accept answers 409 `already`, `rule_limit` or `not_available`. The Rules page card (`SuggestionsCard.tsx`) sits above the newsletters card: a member sees the rows and one line, an owner who can write sees Accept and Dismiss. A 404 leaves that mailbox out of the card. The weekly report has one line with the count and a fixed link to `/rules` ([digest-and-notices.md](digest-and-notices.md) rule 3f). The reason of a row is counts only.
11. **The sender line.** Activity detail and the Approvals summary show one line under the From line: the relation, how many of the mails in 90 days the user answered, how many times the user wrote to them, and the days since their last mail (`senderLineText`). `readSenderLines` makes one profile read for a page. The key is left out with `sender_context` off; a follow-up, a mail with no stored address and a sender with no profile give `null`. Telegram has no sender line (question Q1 of the plan: panel only).
12. **The contact wait.** With `contact_wait` on, a new `waiting` or `delegated` open loop with no stated date waits `clamp(ceil(1.5 × median reply hours of the contact / 24), 1, 7)` working days instead of the owner's `loop_wait_days`. It needs at least 5 reply samples of the counterpart. The loop gets `due_source = 'contact'` and `usual_reply_days = clamp(round(hours / 24), 1, 60)`. The panel and the brief show "usual reply" ([open-loops.md](open-loops.md) rule 17). It is read once when the loop opens.
13. **Known domains for the look-alike rule.** The registrable domains of To and Cc of the user's Sent mail (at least 2 mails in 90 days) become look-alike targets; they never exempt themselves and never make a sender known ([triage.md](triage.md) rule 17).
14. **The profile line of the classifier.** `classifier-v4` is `classifier-v3` plus the part `profile`. The dev runs of 2026-11-19 found no win over the production prompt (K 24.5 against 23.0) or over `classifier-v3[list]` (13.5 against 14.0). No holdout run was made, the pointer stays `classifier-v2`, and the profile reader is wired in `start/triage.ts` but production reads no profile ([triage.md](triage.md) rule 18, `evals/results/2026-11-19-f120-v4-dev-summary.md`). The rule line `PROFILE_RULE` is strong (a known relation "is not spam"): do not ship it without a new decision of the owner.
15. **Log lines and audit.** Log lines hold ids and counts only, never an address, a hash or a subject: `contacts_refresh_done` (`mailbox_id`, `count`, `zeroed`, `duration_ms`), `contacts_refresh_mailbox_failed`, `contacts_suggestion_refused` (a count), `contact_wait_failed` (an error name and code). Audit: rule 9; the data-request audit rows keep `address_hash` and counts ([account-data.md](account-data.md) rule 13).

## Entry points

| Kind     | Name                                                                 | Where                                                        |
| -------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| job      | `contacts.refresh` (hourly, minute 7)                                | `apps/server/src/modules/contacts/jobs.ts`                   |
| CLI      | `bun run job:run --name contacts.refresh`                                   | `apps/server/src/scripts/job-run.ts`                         |
| CLI      | `bun run org:flag --org-id <uuid> --flag <key> --on`                 | `apps/server/src/scripts/org-flag.ts`                        |
| function | `refreshMailboxProfiles`, `readProfiles`                             | `apps/server/src/modules/contacts/refresh.ts`                |
| function | `readSenderActivity` (composes the readers below)                    | `apps/server/src/modules/contacts/activity.ts`               |
| function | `senderWindow`, `incomingCountsBySender`, `ownAddressesOf`           | `apps/server/src/modules/mail/repo/sender-activity.ts`       |
| function | `sentCountsByRecipient`, `repliedBySentBySender`                     | `apps/server/src/modules/mail/repo/sender-replies.ts`        |
| function | `userReplyDelaysBySender`, `theirReplyDelaysBySender`                | `apps/server/src/modules/mail/repo/sender-delays.ts`         |
| function | `newestResultsBySender`, `newestFeedbackBySender`                    | `apps/server/src/modules/triage/repo/sender-activity.ts`     |
| function | `delegationCountsByDelegateAddress`                                  | `apps/server/src/modules/delegation/repo/sender-activity.ts` |
| function | `acceptSuggestion`, `dismissSuggestion`                              | `apps/server/src/modules/contacts/suggestion-commands.ts`    |
| function | `refreshSuggestions`, `suggestionBlockedNow`                         | `apps/server/src/modules/contacts/suggest.ts`                |
| function | `readSenderLines`, `senderLineOf`                                    | `apps/server/src/modules/contacts/lines.ts`                  |
| function | `contactWaitFor`                                                     | `apps/server/src/modules/contacts/wait.ts`                   |
| function | `deleteOldProfiles`, `deleteEndedSuggestions`                        | `apps/server/src/modules/contacts/privacy.ts`                |
| function | `senderContextRowsOf`, `deleteSenderContextRowsOf`                   | `apps/server/src/modules/contacts/privacy.ts`                |
| function | `senderProfileReader` (the classifier reader)                        | `apps/server/src/composition.ts`                             |
| function | `senderKeyHash`                                                      | `apps/server/src/platform/crypto.ts`                         |
| route    | `GET /api/suggestions/:mailboxId`, `POST …/accept`, `POST …/dismiss` | `apps/server/src/modules/contacts/routes.ts`                 |
| page     | the Suggestions card of the Rules page                               | `apps/web/src/components/rules/SuggestionsCard.tsx`          |
| page     | the sender line of Activity and Approvals                            | `apps/web/src/lib/activity-text.ts`                          |
| function | `suggestionsFor` and the wait rules (pure)                           | `packages/core/src/contacts/suggestions.ts`                  |
| function | `contactWaitDays`, `usualReplyDays` (pure)                           | `packages/core/src/contacts/wait.ts`                         |

## Data

- `sender_profiles` (migration `db/migrations/20261118120001_sender_context.sql`; RLS on `org_id`; cascade with the mailbox): `key_hash`, the counts of rule 2, `by_category` and `corrections` (JSON: closed keys, numbers ≥ 0), `bulk_signals`, `median_user_reply_hours`, `median_their_reply_hours`, `reply_samples_theirs`, `relation`, `first_seen_at`, `last_seen_at`, `last_user_mail_at`, `refreshed_at`. Unique `(mailbox_id, key_hash)`. `first_seen_at` and `last_seen_at` hold incoming mail only.
- `sender_suggestions`: `key_hash`, `scope` (`address` or `domain`), `kind`, `pattern` (null after the end), `reason` (counts), `status`, `created_at`, `ended_at`, `ended_by`. One open row for each `(mailbox_id, scope, key_hash, kind)`.
- `open_loops.due_source` also holds `contact`; `open_loops.usual_reply_days` (1 to 60).
- The data category `sender-context` (subject: other people, 365 days) is in the registry and in `docs/legal/records-of-processing.md`. The migration only adds things (expand only).
- Status flow of a suggestion: rule 8.

## Limits

- The profile counts only mail that still exists. After an erase of a person, a later pass can write a profile row again for mail that the erase kept (mentions stay); that row counts only that mail.
- A change of `CREDENTIALS_KEY` makes the old rows unreachable: they stay until the 12 months of retention end, and a DSR erase cannot find them (a row holds dates and counts, no address). The export cannot name them either. The next pass writes new rows under the new key.
- A domain suggestion is not erased by an address erase (question Q5 of the plan).
- Telegram has no sender line (question Q1 of the plan).
- The profile line is not in production: the dev runs found no win (rule 14).
- Known domains need Sent sync (`sent_sync`, [sent-mail.md](sent-mail.md)) and both flags `sender_context` and `suspicious_mail`. The sim eval has no Sent history and does not measure them.
- A blocklist suggestion needs current Sent coverage. The first Sent pass reads 30 days only, so for the first 60 days "never wrote in 90 days" means "never wrote since the Sent history starts". A Sent outage of more than a day withdraws the open blocklist rows.
- A row lives 30 days but its counts need 90 days of mail, so at Accept the sender can show no activity: the check then judges by rules, delegates and coverage only. A delegate that commits while Accept waits for the row lock is not seen, and the rule stays.
- The pass time: on 5,000 mails from 500 senders and 2,000 Sent mails the first pass took about 380 ms and a repeat pass about 365 ms in the CI test (`contacts-refresh-time.test.ts`; the bound is 15 s). The time on the VPS is a check of the pilot (F120 stage 13).
- The contact wait needs 5 reply samples. A Later tap or a Restart moves the due date but leaves `due_source = 'contact'`, so the line "usual reply" stays on the loop.
- With the flag off and N mailboxes the Suggestions card sends N list requests (web-panel.md).
- The history check (`trust/history-classify.ts`) does not pass the profile reader: wire it if the pointer ever moves to a prompt with `profile`.

## Decisions

- ADR 0034 (profiles from counts, accepted with amendments), ADR 0027 (flags), ADR 0036 (open loops), ADR 0029 (read Sent).
- The questions Q1 to Q15 of the plan and their defaults are in the file `questions.md` of ticket F120.
- PD-104 to PD-114 (`docs/product/stage-2/epics/E11-contacts-and-context.md`); the plan and the owner questions: ticket F120 (e11a-sender-context).

## Tests

- `packages/core/src/contacts/suggestions.test.ts`
- `packages/core/src/contacts/wait.test.ts`
- `apps/server/test/integration/contacts-refresh.test.ts`
- `apps/server/test/integration/contacts-refresh-job.test.ts`
- `apps/server/test/integration/contacts-refresh-time.test.ts`
- `apps/server/test/integration/contacts-privacy.test.ts`
- `apps/server/test/integration/contacts-retention.test.ts`
- `apps/server/test/integration/contacts-suggestions.test.ts`
- `apps/server/test/integration/contacts-suggestion-commands.test.ts`
- `apps/server/test/integration/web-suggestions.test.ts`
- `apps/server/test/integration/contacts-sender-line.test.ts`
- `apps/server/test/integration/loops-contact-wait.test.ts`
- `apps/server/test/integration/triage-known-domains.test.ts`
- `apps/server/test/integration/triage-extras-profile.test.ts`
- `apps/server/test/integration/sender-context-rollback.test.ts`
- `apps/server/src/sender-context-docs.test.ts`
