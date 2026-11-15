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

## Not verified

- **N1** Interia threads an APPENDed follow-up and keeps the To/Cc (stage 25).
- **N2** `extractor-v1` meets the gate (stage 06).
