# F109 stage 06: attachment line in notices (decisions and limits)

Code: `packages/core/src/digest/attachment-line.ts` (`attachmentLine`, `attachmentFact`), texts `packages/core/src/texts/attachments.ts`, reader `listAttachmentInputs` (`mail/repo/headers.ts`) and flag-gated `attachmentFactsToShow` (`mail/attachment-facts.ts`), flag `attachment_line` (default off).
Tests: `packages/core/src/digest/attachment-line.test.ts`, `apps/server/test/integration/mail-attachment-facts.test.ts`, new cases in `channels-notices`, `reports-digest`, `web-telegram`, and the core notices, digest, registry and web i18n tests.

## Decisions

- Consent bump: attachment names and sizes come from the mail and go to Telegram, so `TELEGRAM_CONSENT_VERSION` is `2026-11-15` and the consent text (`tg_consent_text`, en and pl) names "the names and sizes of their attachments" (pl "nazwy i rozmiary ich załączników"). The owner decision of 2026-11-15 (a fixed phrase from our own codes needs no bump) does not apply: names are mail data. The coordinator may log this in `docs/owner-decisions.md`.
- The line number `n` = count of the mail minus the inline and `text/calendar` parts that the list holds (capture keeps 20 parts; the count is the true total). After retention the list is `[]` and the line is `📎 <count>`.
- The line goes after the subject line (urgent notice, digest item), before the AI line. Names go through `removeLinks` and `cutText` (40 code points, the last one is `…` when cut). A comma joins `+<k> more` to the names.
- The urgent view field `attachments` (`{ attachments: ≤ 3 parts, count }`) is optional on read and written only with the flag on and a line to show. A view queued earlier or after a rollback renders as before. The stored names are already cleaned.
- The digest builds the fact at build time (nothing stored). The web activity row is out of scope.
- No migration, no `bun.lock` change.

## Limits

- A mail whose size passed the capture limit has `parts_known = false` and no attachments: no line.
- Old queued `urgent` rows have no field: no line even with the flag on.
- Capability pages: `digest-and-notices.md` has the new rule text; stage 16 re-checks it.

## Mutation checks (each alone; logs in /tmp/f109-s06/mut, sources restored)

20 mutations, each fails a test: org filter of the reader, flag guard, inline and calendar filters, urgent and digest field writes, renderer pass-through, the view optional field, fact cut and null guard, line push in both renderers, link removal, name cut, count arithmetic, Polish decimal comma, retention count filter, consent text and consent version (the version needed a new case in `web-telegram.test.ts`).
