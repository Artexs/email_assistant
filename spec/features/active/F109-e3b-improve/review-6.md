# F109 stage 06 review (Opus FAIL on candidate a7f65aa6, 2026-11-15)

One blocker (B1) and one test gap (T1), fixed in the follow-up commits. Notes below are for later tickets.

## Fixed

- B1: master F113 added `LAB_FLAGS_ON` and `LAB_FLAGS_OFF` (`apps/server/src/modules/lab/seed.ts`). Every flag is in one list: `attachment_line` is now in `LAB_FLAGS_ON` after `suspicious_mail` (the lab needs the line on to show it). Master is merged; `lab-seed.test.ts` passes.
- T1: the `attachmentFact` unit test checks a stored name of 40 code points for a 60-character name and `[link]` for `https://x.test/a`. Mutation `name: part.name` in `attachmentFact` fails it.
- N2: the consent text says "names (or file types) and sizes" (pl "nazwy (lub typy plików) i rozmiary"), because the line shows the MIME type when the name is empty. The version stays `2026-11-15`.
- N1 (docs part): `docs/code-patterns.md` § The consent version says the gate blocks only new links.

## Notes

- N1: the version gate has one reader, `POST /channels/telegram/link`. Detectors and the sender never read it, so a linked chat with an old consent gets the line when the flag is on (scratch test of the review). Owner decision of 2026-11-15 (coordinator): the flag stays off for orgs with linked chats until a re-ask exists (a consent version per chat link and a send-side gate, about one stage) or the owner accepts the gap.
- N2: see Fixed.
- N3: cut names can stay in `outbox.view` and `outbox.text` up to `RETENTION_TEXT_DAYS` (90 days), longer than `email_headers` (`data_retention_days`, default 30, minimum 1). Up to 3 names per view; subjects live as long. Stage 16 writes it into `retention.md`.
- N4: names are plain text (no `parse_mode`). Removed: newlines, bidi characters, U+200B, U+FEFF; lone surrogates become U+FFFD. Both production paths clean twice, so a zero-width space inside a link gets `[link]`. Left: bare domains such as `pay-here.com` or `invoice.zip` (Telegram may link them; the subject has the same limit), IBAN-like text, U+200C, U+200D, U+00AD.
- N5: after retention the count also includes inline and calendar parts, so an inline-only mail shows `📎 1` once its list is cleared. The list is cut at 20 parts, so inline parts beyond 20 count as attachments. A mail over the size limit has `partsKnown=false` and gets no line. Accepted (D8).
- N6: rollback. The old code reads the urgent view with a strict object and would refuse pending rows that hold `attachments`. Turn the flag off and let pending rows drain before a rollback.
- N7: readers confirmed: `listAttachmentInputs` filters by `org_id` (second-org test), `attachmentFactsToShow` reads the flag, the digest stores nothing, no migration, no `bun.lock` change.
