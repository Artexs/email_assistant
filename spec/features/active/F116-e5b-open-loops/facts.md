# F116 · Facts

Part of [plan.md](plan.md). Read at plan base 9531f16a; scout leads in [scouts.md](scouts.md).

## Facts checked (2026-11-15, 9531f16a)

- **F1** `sent_emails` and its readers as in `docs/capabilities/sent-mail.md`; no post-store hook; `sent_emails_thread_idx` exists; `emails` has no thread index.
- **F2** `delegations.email_id`, `draft_action_id`, `send_action_id` and `actions.email_id` are NOT NULL; actions have no `mailbox_id`; the claim scopes by `emails.mailbox_id`.
- **F3** `suspiciousThreadKeysOf(db, ctx, mailboxId, threadKeys)` is exported by `triage`.
- **F4** LLM role `extractor` exists; `addWorkingDays` is in `core/metrics/week.ts`; M2 counts delegations only.
- **F5** `email_headers` keeps `auto_submitted`, `precedence`; no `X-Autoreply`, no DSN type.
- **F6** Callback values ≤ 64 bytes; two plain UUIDs do not fit.
- **F7** No "first digest of the day" marker; mailbox modes are `shadow` and `assist`.
- **F8** The claim's mail-age limit (7 days) applies only to mailbox changes, not to drafts and sends (`actions/repo/claims.ts`).
- **F9** The offline-lab corpus shapes (`packages/core/src/sim`) describe incoming mail with a category label; no shape for sent mail exists.

## Facts checked at refresh 1 (2026-11-15, 09704dcd)

- **F10** `TELEGRAM_CONSENT_VERSION` = `"2026-11-15"` (F109 stage 06). The server compares the link body by equality (`channels/routes.ts`); `web.telegram_consent` audit rows hold `data.version`. The consent text is the panel key `tg_consent_text` (`apps/web/src/i18n/en.ts`, `pl.ts`), tested in `apps/web/src/i18n/i18n.test.ts`; `packages/core/src/texts/` holds no consent text.
- **F11** `featureFlags` has `attachment_line` (E3b, off); no `open_loops`, no `delegate_button` yet. `tenancy-features.test.ts` lists every flag in registry order.
- **F12** Digest rows show `📎 …` after the subject when `attachment_line` is on (`DigestItem.attachments`, `reports/digest.ts` via `mail.attachmentFactsToShow`); `reports-digest.test.ts` has the F109 test "digest attachment line".

## Not verified

- **N1** Interia threads an APPENDed follow-up and keeps the To/Cc (stage 25).
- **N2** `extractor-v1` meets the gate (stage 06).
- **N3** Telegram shows at most 8 inline buttons per keyboard row (a common client limit; not in the Bot API text). Stage 19 keeps rows at ≤ 8 and checks the render in the live chat at stage 25 (review N11).
