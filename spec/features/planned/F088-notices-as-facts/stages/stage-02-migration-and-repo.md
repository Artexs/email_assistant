# F088 stage 02 — Migration `outbox_view`, repository reads and writes, retention [risky]

Part of [`../plan.md`](../plan.md). `[risky]`: a migration, a privileged SQL function, retention of mail-derived text. Decisions: D2, D8, D16, D18 (repository part), D19, D20, D22 (DB part), D23. Needs stage 01 landed (core kinds and schemas). Runs alone among migration jobs (`plan.md` § How to run). Three steps.

No producer changes in this stage: the detectors, the digest job and the mailbox-removed path still pass `message` and get the default view `{}`. The sender still sends `text`.

## Step 1 — The migration and `db:types`

**Goal.** `outbox` gets `view`, `channel`, `locale`, `detail`; `text` may be null; `delete_mailbox` clears `view` of digest rows.

**Files.** New: `db/migrations/<YYYYMMDD>100001_outbox_view.sql` (the build day; the name must sort after the newest file in `db/migrations/`; if a file of that day with `100001` exists, use `100002`). Regenerated: `apps/server/src/platform/db/schema.ts` (`bun run db:migrate`, then `bun run db:types`; never by hand).

**Interfaces.** The SQL, as written:

```sql
-- migrate:up
-- A notice is stored as facts and rendered when it is sent (ADR 0032 point 5). `text` and `buttons` become the cache
-- of the sent message: null until the send.
ALTER TABLE outbox
  ADD COLUMN view jsonb NOT NULL DEFAULT '{}' CONSTRAINT outbox_view_check CHECK (jsonb_typeof(view) = 'object'),
  ADD COLUMN channel text NOT NULL DEFAULT 'telegram' CONSTRAINT outbox_channel_check CHECK (channel IN ('telegram')),
  ADD COLUMN locale text NOT NULL DEFAULT 'en' CONSTRAINT outbox_locale_check CHECK (locale IN ('pl', 'en')),
  ADD COLUMN detail text NOT NULL DEFAULT 'full' CONSTRAINT outbox_detail_check CHECK (detail IN ('full')),
  ALTER COLUMN text DROP NOT NULL;

-- Digests mix mailboxes: a pending one is dropped (the next slot covers the period), a sent one loses its text and view.
CREATE OR REPLACE FUNCTION delete_mailbox(p_org_id uuid, p_mailbox_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.mailboxes WHERE id = p_mailbox_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mailbox not found' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM public.audit_log WHERE org_id = p_org_id AND data->>'mailbox_id' = p_mailbox_id::text;
  DELETE FROM public.outbox WHERE org_id = p_org_id AND kind = 'digest' AND status IN ('pending', 'sending');
  UPDATE public.outbox SET text = '[removed]', view = '{}'
    WHERE org_id = p_org_id AND kind = 'digest' AND status IN ('sent', 'failed');
  DELETE FROM public.mailboxes WHERE id = p_mailbox_id AND org_id = p_org_id;
END;
$$;

-- migrate:down
-- Rows without text cannot go back to NOT NULL: a waiting one fails as outdated, every one gets the removed marker.
UPDATE outbox SET status = 'failed', error_code = 'outdated', locked_at = NULL
  WHERE text IS NULL AND status IN ('pending', 'sending');
UPDATE outbox SET text = '[removed]' WHERE text IS NULL;
ALTER TABLE outbox ALTER COLUMN text SET NOT NULL;
CREATE OR REPLACE FUNCTION delete_mailbox(p_org_id uuid, p_mailbox_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.mailboxes WHERE id = p_mailbox_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mailbox not found' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM public.audit_log WHERE org_id = p_org_id AND data->>'mailbox_id' = p_mailbox_id::text;
  DELETE FROM public.outbox WHERE org_id = p_org_id AND kind = 'digest' AND status IN ('pending', 'sending');
  UPDATE public.outbox SET text = '[removed]' WHERE org_id = p_org_id AND kind = 'digest' AND status IN ('sent', 'failed');
  DELETE FROM public.mailboxes WHERE id = p_mailbox_id AND org_id = p_org_id;
END;
$$;
ALTER TABLE outbox DROP COLUMN detail, DROP COLUMN locale, DROP COLUMN channel, DROP COLUMN view;
```

Before you write it, open `db/migrations/20261111000001_delete_mailbox.sql` and compare the function body line by line with the body above: the only change in `up` is `, view = '{}'` and the line break of that `UPDATE`. If the file differs from the body above in any other line (a later migration may have replaced the function: `grep -ln "FUNCTION delete_mailbox" db/migrations/*.sql`), copy the newest body and add only `, view = '{}'`; report it in the final message. `CREATE OR REPLACE` keeps the owner and the grants (`REVOKE … FROM PUBLIC`, `GRANT EXECUTE … TO app`); do not repeat them, and check them in test 7 below.

**Decisions.** D2, D19, D20.

**Test.** `apps/server/test/integration/telegram-schema.test.ts`, a new `describe("outbox view columns (F088)")` (the file has an `insert` helper and `expectCode` at line 62 and 269; reuse them):

1. An insert without the new columns gets `view = {}`, `channel = 'telegram'`, `locale = 'en'`, `detail = 'full'`.
2. `text` null is accepted; `text = ''` still fails with `23514`; `'x'.repeat(4097)` still fails with `23514`.
3. `channel = 'mail'`, `detail = 'minimal'`, `locale = 'de'`, `view = '[]'::jsonb` each fail with `23514`.
4. The CHECK lists match core (D22): read `pg_get_constraintdef(oid)` from `pg_constraint` where `conrelid = 'outbox'::regclass` and `conname` is `outbox_kind_check`, `outbox_channel_check`, `outbox_locale_check`, `outbox_detail_check`; take the quoted values with the regex `/'([a-z_]+)'/g`; compare sorted with `noticeKinds`, `noticeChannels`, `userLocales`, `noticeDetails` from `@ea/core`.

**Check.** `bun run db:migrate && bun run db:types` (own DB of the job). Then `bun run db:rollback && bun run db:migrate` once; paste the last line of each in the final message. `git diff --stat apps/server/src/platform/db/schema.ts` shows a change only from `db:types`.

**Done when.** Tests 1–4 pass; the rollback and the migrate both print success.

**Out of scope.** Any index change (the retention query reads by `org_id`, `created_at`, `status` as today).

## Step 2 — Repository: insert, claim, mark, find, fail code, linked chats

**Goal.** The repository reads and writes the new columns, and `LinkedChat` carries the member's locale. The producers and the sender keep working unchanged.

**Files.** `apps/server/src/modules/channels/repo.ts`, `apps/server/src/modules/channels/port.ts`, `apps/server/src/modules/channels/index.ts`, `apps/server/src/modules/channels/sender.ts` (two small changes), the test files named below, and every object literal typed `LinkedChat` (`bun run typecheck` lists them: `actions-logs.test.ts:146`, `actions-send-logs.test.ts:184`, `channels-callbacks.test.ts:64,759`, `channels-commands.test.ts:87`, and unit tests under `channels/telegram/` if any).

**Interfaces.**

- `outboxKinds` / `OutboxKind` (D23): `export const outboxKinds = noticeKinds; export type OutboxKind = NoticeKind;` (import from `@ea/core`); `outboxKindSchema` becomes `noticeKindSchema`.
- `outboxFailCodes` gains `"bad_view"` at the end.
- `NewOutboxRow` gains `view?: Record<string, unknown>` (default `{}`) and `locale?: UserLocale` (default `"en"`). `insertOutbox` writes `view: JSON.stringify(row.view ?? {})` and `locale: row.locale ?? "en"`; `channel` and `detail` take the DB defaults. It still writes `text` and `buttons` from `row.message` (stage 03 and 04 change this).
- `ClaimedOutbox` gains `view: unknown`, `channel: NoticeChannel`, `detail: NoticeDetail`, `locale: UserLocale`, and `text` becomes `string | null`. `claimDueOutbox` returns `o.view`, `o.channel`, `o.detail`, `o.locale` and parses the three strings with `z.enum(noticeChannels)`, `z.enum(noticeDetails)`, `userLocaleSchema`.
- `markOutboxSent(db, ctx, id, lockedAt, sent: { messageId: number; at: Date; message: OutMessage })`: the same `UPDATE` also sets `text: sent.message.text` and `buttons: JSON.stringify(outButtonsSchema.parse(sent.message.buttons))`.
- `findOutboxByDedup` returns `{ id: string; text: string | null; channel: NoticeChannel; detail: NoticeDetail; locale: UserLocale } | undefined`.
- `LinkedChat` (`port.ts`) gains `locale: UserLocale`. `selectLinkedChats` adds `.innerJoin("users", "users.id", "chat_links.user_id")` and selects `users.locale`; `toLinkedChat` sets `locale: userLocaleSchema.nullable().parse(row.locale) ?? "pl"` with the comment `// A user without a locale gets Polish, as the auth mails (spec/features/active/F082-s6b-public-login/plan.md, B1).` (use the folder path where F082 lives when you build).
- `sender.ts`: (a) right after the 24 h check, `if (row.text === null) { await fail(row, "bad_view"); log.error(\`outbox ${row.id}: no text (${row.kind})\`); continue; }` with the comment `// Until the sender renders views (spec/features/active/F088-notices-as-facts/, stage 04), every row has a text.`; (b) `markOutboxSent(trx, ctx, row.id, row.lockedAt, { messageId, at: now, message: { text: row.text, buttons: row.buttons } })`.
- `index.ts`: no new export needed (types flow through `ClaimedOutbox`); keep the list sorted as it is.

**Decisions.** D16, D18, D23.

**Test.**

- `apps/server/test/integration/channels-outbox.test.ts`, new cases:
  1. `insertOutbox` with `view: { a: 1 }`, `locale: "pl"` stores them; `claimDueOutbox` returns `view` deep-equal `{ a: 1 }`, `channel: "telegram"`, `detail: "full"`, `locale: "pl"`, and the text.
  2. `insertOutbox` without `view` and `locale` stores `{}` and `"en"`.
  3. `markOutboxSent` with `message: { text: "sent text", buttons: [[{ text: "OK", data: "ok" }]] }` writes both columns; the row reads back with that text and those buttons.
  4. `findOutboxByDedup` returns `locale` and `channel`; for a row whose `text` was set to null by a raw `UPDATE`, it returns `text: null`.
- `apps/server/test/integration/channels-linking.test.ts` (or the test file that covers `listLinkedChats`; `grep -ln "listLinkedChats" apps/server/test/integration`), new cases:
  5. A member whose `users.locale` is `'en'` gets `locale: "en"`; `'pl'` gets `"pl"`; null gets `"pl"`. Check with `listLinkedChats`, `listLinkedChatsOfOrg`, `getChatLinkForUser` and `findChatLink`.
- `apps/server/test/integration/channels-sender.test.ts`, new case:
  6. A row whose `text` is set to null by a raw `UPDATE` ends `failed` / `bad_view`; nothing is sent; the log lines of the run hold the row id and no text of the row.

**Check.** `bun test apps/server/test/integration/channels-outbox.test.ts apps/server/test/integration/channels-sender.test.ts apps/server/test/integration/telegram-schema.test.ts` and the linking test file; `bun run typecheck`.

**Done when.** Tests 1–6 pass; the old cases of these files pass unchanged.

**Out of scope.** Producers (stage 03). Rendering in the sender (stage 04).

## Step 3 — Retention and the mailbox delete clear `view`

**Goal.** No view outlives the retention period or a mailbox removal (acceptance "Retention clears `view` with `text`").

**Files.** `apps/server/src/modules/channels/repo.ts` (`clearOutboxTexts`), `apps/server/test/integration/retention-clear.test.ts`, `apps/server/test/integration/delete-mailbox.test.ts`.

**Interfaces.** `clearOutboxTexts`, first loop: `.set({ text: "[removed]", view: JSON.stringify({}) })` (a jsonb value goes in as JSON text, as `insertOutbox` does with `buttons`), and the inner select filter `.where((eb) => eb.or([eb("text", "is distinct from", "[removed]"), sql<boolean>\`view <> '{}'::jsonb\`]))` in place of `.where("text", "<>", "[removed]")`. Second loop (pending and sending rows): add `view: JSON.stringify({})` to its `.set`. Update the comment above the function: "the text and the view of an old message go after the period" (no bare codes in the changed comment lines).

**Decisions.** D8, D19.

**Test.**

- `retention-clear.test.ts` (the outbox case near line 523 inserts rows with raw SQL; add `view` to them):
  1. A `sent` row older than the cutoff with `view = '{"subject":"MARKER"}'` → `text = '[removed]'`, `view = {}`.
  2. A `failed` row with `text` null and a non-empty view → `text = '[removed]'`, `view = {}`.
  3. A `pending` row older than the cutoff with a view → `failed` / `expired`, `text = '[removed]'`, `view = {}`.
  4. A second call returns `0` and changes nothing.
  5. A row younger than the cutoff keeps its view.
- `delete-mailbox.test.ts`: the fixture at line 48 inserts the digest rows; give them `view: { text: "Digest of A", buttons: [] }` through `insertOutbox`. After `delete_mailbox`:
  6. the sent and failed digest rows have `view = {}` and `text = '[removed]'`;
  7. the function still has `EXECUTE` for `app` and not for `PUBLIC` (`has_function_privilege('app', 'delete_mailbox(uuid, uuid)', 'EXECUTE')` is true; for `public` false), and `prosecdef` is true.

**Check.** `bun test apps/server/test/integration/retention-clear.test.ts apps/server/test/integration/delete-mailbox.test.ts apps/server/test/integration/retention-job.test.ts`.

**Done when.** Tests 1–7 pass; the Proof of `plan.md` with `NN` = `02` ends with `PROOF_OK`.

**Out of scope.** The retention job schedule; any other table.
