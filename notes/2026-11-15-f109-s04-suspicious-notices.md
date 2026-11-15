# F109 stage 04: warning line, readers, activity field (decisions and limits)

Code: `apps/server/src/modules/triage/suspicious-repo.ts` (`suspiciousReasonsOf`, `suspiciousThreadKeysOf`), `suspicious-show.ts` (`suspiciousReasonsToShow`), core texts `packages/core/src/texts/suspicious.ts`, `suspiciousLine` in `packages/core/src/digest/notices.ts`.
Tests: `apps/server/test/integration/triage-suspicious-readers.test.ts`, plus new cases in `channels-notices`, `reports-digest`, `reports-activity` and the core unit tests of notices, digest, texts, registry and web activity.

## Interface for E5b, E6a, E4-B (F115, F116)

- `suspiciousReasonsOf(db, ctx, emailIds)` ignores the flag. A draft block calls it. Absent from the map = no reason.
- `suspiciousThreadKeysOf(db, ctx, mailboxId, threadKeys)` takes the mailbox: the `emails` table holds incoming mail only, and a thread key is unique per mailbox. Scope: `org_id` and `mailbox_id`.
- `suspiciousReasonsToShow(db, ctx, emailIds)` is for what the user sees: it is empty while the flag `suspicious_mail` is off. Do not use it for a draft block.

## Decisions

- The warning line sits after the AI line (`💬`) and before the "Received" line (urgent) or the "→ would do" line (digest).
- A flagged `delegation` item in the digest replaces the "→" line with `→ no draft: suspicious mail`. Other categories keep their "→" line.
- The urgent view field `suspicious` is optional on read (old views in the outbox render as before). The producer always writes it (`[]` with the flag off).
- The digest and the urgent notice are built per organization; the flag is read once per build (one `isFeatureOn` query).
- Activity item field `suspicious` is required in the web schema (`activityItemSchema`); the server always sends it. `listActivity` now runs at most 9 queries (flag read and reasons read added; test bound moved from 7 to 9, run with the flag on).
- `TELEGRAM_CONSENT_VERSION` is not bumped: the line holds fixed phrases from the rule codes, no mail text and no new data kind. The owner may decide otherwise (user-visible/privacy default).
- No migration. The thread reader has no thread index on `emails`; the `(mailbox_id, thread_key)` lookup scans by mailbox. If E5b calls it per mail in a loop, add an index in that ticket.

## Mutation checks (each alone; logs in /tmp/f109-s04/mut, sources restored)

Each guard removed fails its test: org filter and mailbox filter of both readers, newest-row order, empty-reasons filter, empty-input guards (query count), flag guard in `suspiciousReasonsToShow` (3 tests), urgent/digest/activity field, warning order, empty-list guard, delegation guard, warning line in urgent and digest, renderer pass-through, view optional field.
Equivalent mutant: dropping only the empty-input guard in `suspiciousReasonsToShow` (the repo guard returns the same map; only one query differs).
