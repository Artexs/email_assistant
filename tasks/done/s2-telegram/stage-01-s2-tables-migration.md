# s2-telegram — Stage 1

Part of [`../s2-telegram.md`](../s2-telegram.md). Read that file's "Input" and "Rules for every step" first.

## Stage 1 — S2 tables migration [risky]

- [x] **1.1 Migration `20261106000001_telegram.sql`: `chat_links`, `chat_link_tokens`, `digests`, `outbox`, `mailboxes.status_changed_at`, digest times default**
  - Goal: the schema for chat linking, digests and all scheduled messages, with the guards in the database.
  - Files: create `db/migrations/20261106000001_telegram.sql`; regenerate `apps/server/src/platform/db/schema.ts` (`bun run db:types`, never by hand); create `apps/server/test/integration/telegram-schema.test.ts`.
  - Interfaces: the SQL below. After `db:types` the Kysely types `ChatLinks`, `ChatLinkTokens`, `Digests`, `Outbox` exist; `external_chat_id` and `external_message_id` are `Int8` (a string on select, a number on insert).
  - Decisions:
    - Exact SQL (keep the order; `-- migrate:down` drops in reverse order):

      ```sql
      -- migrate:up
      ALTER TABLE mailboxes ADD COLUMN status_changed_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE memberships ALTER COLUMN digest_times SET DEFAULT '{08:00,16:00}';

      CREATE TABLE chat_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL,
        user_id uuid NOT NULL,
        channel text NOT NULL CHECK (channel IN ('telegram')),
        external_chat_id bigint NOT NULL CHECK (external_chat_id > 0),
        linked_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (org_id, user_id) REFERENCES memberships (org_id, user_id) ON DELETE CASCADE,
        UNIQUE (channel, external_chat_id),
        UNIQUE (org_id, user_id, channel)
      );

      CREATE TABLE chat_link_tokens (
        token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
        org_id uuid NOT NULL,
        user_id uuid NOT NULL,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (org_id, user_id) REFERENCES memberships (org_id, user_id) ON DELETE CASCADE
      );

      CREATE INDEX chat_link_tokens_member_idx ON chat_link_tokens (org_id, user_id);

      CREATE TABLE digests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL,
        user_id uuid NOT NULL,
        slot_key text NOT NULL CHECK (slot_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'),
        period_start timestamptz NOT NULL,
        period_end timestamptz NOT NULL,
        sent_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (period_end >= period_start),
        FOREIGN KEY (org_id, user_id) REFERENCES memberships (org_id, user_id) ON DELETE CASCADE,
        UNIQUE (org_id, user_id, slot_key),
        UNIQUE (id, org_id)
      );

      CREATE TABLE outbox (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL,
        user_id uuid NOT NULL,
        kind text NOT NULL CHECK (kind IN ('digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok')),
        dedup_key text NOT NULL CHECK (length(dedup_key) BETWEEN 1 AND 200),
        email_id uuid,
        mailbox_id uuid,
        digest_id uuid,
        text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 4096),
        buttons jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(buttons) = 'array'),
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_attempt_at timestamptz NOT NULL,
        locked_at timestamptz,
        sent_at timestamptz,
        external_message_id bigint,
        error_code text CHECK (error_code ~ '^[a-z0-9_]{1,40}$'),
        created_at timestamptz NOT NULL,
        CHECK ((kind = 'digest') = (digest_id IS NOT NULL)),
        CHECK (kind <> 'urgent' OR email_id IS NOT NULL),
        CHECK (kind NOT IN ('auth_error', 'sync_stale', 'sync_ok') OR mailbox_id IS NOT NULL),
        CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
        CHECK (status <> 'sending' OR locked_at IS NOT NULL),
        FOREIGN KEY (org_id, user_id) REFERENCES memberships (org_id, user_id) ON DELETE CASCADE,
        FOREIGN KEY (email_id, org_id) REFERENCES emails (id, org_id) ON DELETE CASCADE,
        FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE,
        FOREIGN KEY (digest_id, org_id) REFERENCES digests (id, org_id) ON DELETE CASCADE,
        UNIQUE (org_id, user_id, dedup_key)
      );

      CREATE INDEX outbox_due_idx ON outbox (status, next_attempt_at);
      CREATE INDEX outbox_mailbox_kind_idx ON outbox (org_id, mailbox_id, kind);

      -- migrate:down
      DROP TABLE outbox;
      DROP TABLE digests;
      DROP TABLE chat_link_tokens;
      DROP TABLE chat_links;
      ALTER TABLE memberships ALTER COLUMN digest_times SET DEFAULT '{}';
      ALTER TABLE mailboxes DROP COLUMN status_changed_at;
      ```

    - Why these shapes (D4, D5, D6, D19): every new table hangs on `memberships (org_id, user_id)` with `ON DELETE CASCADE`. `external_chat_id` is `bigint` (a chat id has up to 52 bits) and `> 0` (private chats only, D2). The link token is stored only as a SHA-256 hex hash. `outbox.text` is the message text (mail data, retention 90 days, D5); `outbox.error_code` holds only our own codes, never Telegram text. `outbox.created_at` and `next_attempt_at` have no default: the repository always passes the app clock (tests use fixed times). The repository also passes `chat_links.linked_at` and `chat_link_tokens.created_at`; the defaults are only for manual inserts.
    - The composite foreign keys with a NULL column (`email_id`, `mailbox_id`, `digest_id`) are not checked when the column is NULL (MATCH SIMPLE): this is intended.
    - Grants: the S0 default privileges give `app` SELECT, INSERT, UPDATE, DELETE on the new tables. No `REVOKE` is needed (no append-only table here).
    - Existing rows: the pilot mailbox gets `status_changed_at` = the migration time; the existing pilot membership keeps `digest_times = '{}'` (P1: stage 7 CLI sets it).

  - Test (`telegram-schema.test.ts`, `withRollback`; every statement that must fail runs in its own `trx.savepoint`, and the test checks the Postgres error `code`: `23514` check, `23505` unique, `23503` foreign key):
    1. A new org (fixture `createOrgWithMailbox`) has an owner membership with `digest_times` = `["08:00:00", "16:00:00"]` (select the column), and its mailbox has a non-null `status_changed_at`.
    2. As the test DB role (`app`): insert, select, update and delete one row in each new table.
    3. `chat_links`: `external_chat_id` 0 and −5 → `23514`; the same `(channel, external_chat_id)` for a second member → `23505`; a second link of the same member → `23505`; a link for a user who is not a member of that org → `23503`.
    4. `chat_link_tokens`: `token_hash` `"abc"` and a 64-character upper-case hex string → `23514`.
    5. `digests`: `slot_key` `"2026-11-06 08:00"` → `23514`; `period_end < period_start` → `23514`; the same `(org_id, user_id, slot_key)` twice → `23505`.
    6. `outbox`: `text` of 4097 characters → `23514`; 4096 → OK; `""` → `23514`; kind `digest` without `digest_id` → `23514`; kind `urgent` with a `digest_id` → `23514`; kind `urgent` without `email_id` → `23514`; kind `auth_error` without `mailbox_id` → `23514`; `error_code` `"Bad Request"` → `23514`; status `sent` without `sent_at` → `23514`; status `sending` without `locked_at` → `23514`; `buttons` `'{}'` → `23514`; the same `dedup_key` for the same member → `23505`, for another member of the org → OK.
    7. Cascades: deleting the membership row deletes its `chat_links`, `chat_link_tokens`, `digests` and `outbox` rows; deleting an email deletes its `urgent` outbox row; deleting a mailbox deletes its `auth_error` outbox row.
  - Check: `bun run dev:up && bun run db:migrate && bun run db:types && bun run lint && bun run typecheck && bun run test:int`. Round trip: `bun run db:rollback && bun run db:migrate` both succeed. `git diff --stat apps/server/src/platform/db/schema.ts` shows only the 4 new table interfaces, the new `Mailboxes.status_changed_at` field and the `DB` entries.
  - Done when: the tests pass and the round trip works.
  - Out of scope: repository functions (stages 6, 8, 9, 10), the retention job for `outbox.text` (follow-up, stage 22).
