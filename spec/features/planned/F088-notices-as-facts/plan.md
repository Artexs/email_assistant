# F088 · Notices as facts: plan input

> Written 2026-11-13 from the architecture review §3.4 and §3.10. Input of the `plan-task` session. Ticket: [ticket.md](ticket.md). Runs after F086. It has one migration: not next to F087 or F092.

## Facts (2026-11-13)

- `outbox` (migration `20261106000001_telegram.sql` and later): `kind` CHECK list of 11 kinds, `dedup_key` unique per member, `email_id`, `mailbox_id`, `digest_id`, `text` (1–4096, NOT NULL), `buttons jsonb`, `status`, `attempts`, `next_attempt_at`, `locked_at`, `sent_at`, `external_message_id`, `error_code`.
- `channels/notices.ts` (745 lines): nine detectors (`detectUrgent`, `detectActionFailed`, `detectAuthError`, `detectSync`, `detectApprovals`, `detectApprovalSets`, `detectSendResults`, `detectDelegationAnswered`, `queueMailboxRemovedNotices`) each build a view, call a core renderer (`renderUrgentNotice`, `renderApprovalRequest`, …) and `insertOutbox` with the text. The digest job (`digest-job.ts`) renders in `reports` and queues the text.
- `channels/sender.ts` claims rows, sends `{ text, buttons }` through `ChatChannel.send`, applies quiet hours, per-user limits, backoff, and marks `sent`.
- The approval card edit after a tap (`callbacks.ts`) rebuilds the text with `renderApprovalRequest` plus a status line.
- `OutMessage = { text, buttons[][] }` and `MESSAGE_MAX_CHARS` live in `packages/core/src/digest/message.ts`; the renderers already take a plain view object (`ApprovalView` etc.), so the view is data today.
- `users.locale` (`pl` | `en`) exists since F082 stage 1; `userLocales` in `packages/core/src/tenancy.ts`.
- ADR 0032 point 5: "A notice is stored as facts (kind, ids, counts) and rendered for its channel and detail level when it is sent."

## Design decisions

- **D1 The view is the fact.** `outbox.view jsonb` holds the renderer input the detector builds today (ids, counts, short strings such as the subject that the renderer prints). The detector stops rendering. The sender renders. The digest keeps its rendered text in `view.text` for now (its view is large and lives in `reports`); E4-B gives it a mail renderer.
- **D2 Columns.** Add `view jsonb NOT NULL DEFAULT '{}'`, `channel text NOT NULL DEFAULT 'telegram' CHECK (channel IN ('telegram'))` (E4-B adds `mail`, E9b `push`), `locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('pl','en'))`, `detail text NOT NULL DEFAULT 'full' CHECK (detail IN ('full'))` (E9b adds `minimal`). `text` becomes nullable: null until sent; the CHECK on length applies when not null. Old rows keep their text and an empty view; the sender sends a row with text and an empty view as it is (compatibility until the old rows age out, 90 days).
- **D3 Renderer registry in core.** `packages/core/src/notices/index.ts`: `renderers: Record<NoticeKind, (view: unknown, opts: { channel, detail, locale }) => OutMessage>`; each renderer parses its view with a Zod schema (`viewSchemas[kind]`), so a bad view fails before a send. The existing render functions move under this registry unchanged; `en` texts stay where they are and `pl` keys come with E7-T1.
- **D4 Detector registry.** `channels/notices/<kind>.ts` exports `{ kind, detect(db, ctx, members, now) }`; `channels/notices/index.ts` lists them; `detectForOrg` iterates. The urgent, approval and send-result detectors keep their queries; only the `queue` call changes shape.
- **D5 Completeness test.** `outboxKinds` (core) = keys of `renderers` = keys of the detector list (the digest and `mailbox_removed` have "queue" functions instead of detectors; the test accepts a `queuedBy` marker). The DB CHECK list is compared in an integration test (`pg_constraint`).
- **D6 Locale per row.** The detector reads the member's `users.locale` once per organization run and stores it. A locale change after the queue does not re-render a pending row; that is acceptable (rows live minutes).
- **D7 Edits.** The approval card edit renders `renderers.approval(view, …)` plus the status line from the same registry (`renderers.approval_status`), so the edit never drifts from the card.
- **D8 Retention.** `clearOutboxTexts` clears `view` and `text`; `docs/architecture.md` §7 row "Message text" names both.

## Stages

1. **Migration and repository.** Files: `db/migrations/<day>100001_outbox_view.sql`, `db:types`, `channels/repo.ts` (`insertOutbox` takes `view`, `locale`; `claimDueOutbox` returns them), retention clear, the schema integration test. Runs alone (migration).
2. **Renderer registry.** Files: `packages/core/src/notices/{index,schemas}.ts`, moves of the render functions (keep the old export names as aliases for one stage), the completeness unit test.
3. **Sender renders.** Files: `channels/sender.ts` (render at claim; `bad_view` failure), `channels/callbacks.ts` (the edit), `channels/digest-job.ts` (view with text), integration tests `channels-sender`, `channels-outbox`, `channels-callbacks` (texts byte-identical).
4. **Detector registry.** Files: `channels/notices/*.ts` split from `notices.ts`, `channels/index.ts`, the detector-list test, `channels-notices` integration tests pass unchanged.
5. **Docs and standards.** Files: `docs/code-patterns.md` (§ "Notices are facts", checklist "add a notice kind"), `.agents/limen/styleguide.md`, `docs/architecture.md` §5 (`outbox` row) and §7, ADR 0032 (note: point 5 landed by F088), `docs/modules.md` §3.8.

Parallel: stage 1 alone. Stage 2 may run next to stage 1 (core only). Stage 3 after 1 and 2. Stage 4 after 3. Stage 5 last.

## Done when

- The five acceptance lines hold.
- `channels/notices.ts` no longer exists as one file; no file in `channels/notices/` is over 400 lines.

## Open questions for the plan-task session

- Whether the digest view should carry the rendered text (D1) or the digest data. Default: the text, because E4-B designs the mail digest and will need the data shape then.
- Whether `detail` is a column now or only in E9b. Default: now, with one value, so the CHECK list is the only later change.
