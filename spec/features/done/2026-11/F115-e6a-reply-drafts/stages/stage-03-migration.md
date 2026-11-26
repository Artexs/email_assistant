# F115 stage 03 — Migration, notice kinds and privacy maps

Part of [`../plan.md`](../plan.md). `[risky]` (migration, privacy maps). The only migration of F115; no other migration may build next to it. Builds after gate G1. Refresh 1 moved the repositories, retention, flag and switch to stage 03b (review finding 9); this stage keeps what must land in the commit of the migration, because the schema tests compare the DB with the code registries.

## Step 1 — Migration

- **Goal:** one migration file with the tables, the index and the outbox kinds of `interfaces.md` § Data, then `bun run db:types`.
- **Decisions:**
  - `reply_requests` and `mailbox_profiles` as `interfaces.md`. CHECKs: `trigger IN ('auto','tap','redraft','sample')`; the status list; `char_length(instruction) <= 300`; profile lengths. Composite FKs `(email_id, org_id)` and `(mailbox_id, org_id)` → cascade; `previous_send_id` and `send_action_id` → `actions (id, org_id)` `ON DELETE SET NULL` (a data-request erase may delete actions). RLS as every org table (copy the policy shape of the newest table).
  - `INSERT INTO mailbox_profiles (mailbox_id, org_id, signature) SELECT m.id, m.org_id, NULLIF(o.style_text, '') FROM mailboxes m JOIN organizations o …` (expand step, D13). `organizations.style_text` stays (E6b drops it).
  - No index: `emails_thread_received_idx` on `emails (mailbox_id, thread_key, received_at)` exists (F116 migration `20261115160001_open_loops.sql`). This migration creates none and its Down drops none (F116 review-7 N3).
  - Outbox kinds `replies_ready`, `reply_prompt`, `reply_result` in `outbox_kind_check`: drop and add, with the list of the newest migration that replaced it at `HEAD` plus the three kinds (today `20261115150001_outbox_sent_missing.sql`). `reply_prompt` and `reply_result` need `email_id`, `replies_ready` none: extend `outbox_email_kind_check` the same way (today's shape: `20261115170001_action_loop_anchor.sql`, mail or loop anchor). The `down` part deletes their rows first.
  - `bun run db:check-migrations` passes with no `-- contract:` line: both CHECK replaces only widen, the tables are new (`docs/code-patterns.md` § Migrations).
- **Test (integration):**
  1. Migrate up on a DB with an org whose `style_text` is `"Jan"` and one with `''`: profiles have signature `"Jan"` and null.
  2. A second `auto` request for the same mail → unique violation; a second `tap` request → allowed.
  3. Org B cannot read org A's `reply_requests` row under the tenant role (RLS).
  4. Down, then up again: no error; `emails_thread_received_idx` still exists after the Down.
  5. `bun run db:check-migrations` passes (no finding).

## Step 2 — Notice kinds in core (same commit as the CHECK change)

- **Goal:** the three kinds exist in the code wherever the DB list is compared, so the Proof passes at this stage.
- **Decisions (review B1):**
  - `noticeKinds` (`packages/core/src/notices/kinds.ts`) gains `replies_ready`, `reply_prompt`, `reply_result`, in the order of the CHECK list.
  - `noticeViewSchemas` and `noticeRenderers` (`packages/core/src/notices/`) get a minimal view and renderer per kind: `replies_ready` `{ count, now, timeZone }`; `reply_prompt` `{ emailId }`; `reply_result` `{ emailId, reason }` (a `ReplyBlockReason` or a request status). Each renders one fixed en and pl line, no button. Stages 12–13 replace the views and texts; they keep the kind names.
  - `queuedBy` (`apps/server/src/modules/channels/notices/index.ts`) names the producer of each: `replies_ready` → `replies/notices.ts`, `reply_prompt` and `reply_result` → `replies/telegram.ts` (stages 12–13 create the files; the entry is a name only).
- **Tests that must pass unchanged:** `apps/server/test/integration/telegram-schema.test.ts` (the DB CHECK list equals `noticeKinds`), `packages/core/src/notices/registry.test.ts` (a renderer, a view schema and a fixture per kind: add the three fixtures) and `apps/server/src/modules/channels/notices/registry.test.ts` (a detector or a `queuedBy` entry per kind).
- **Rollback note (no code here):** a release without these kinds fails the whole claim batch of the outbox for all orgs on one such row (`claimDueOutbox` parses `row.kind`, `channels/repo.ts`). Stages 17 and 18 hold the SQL for that case.

## Step 3 — Privacy maps

- **Goal:** the F106 address map (`privacy/address-map.ts`) and export map gain the new text columns: `reply_requests.instruction` (text rule), `reply_requests.sample_body` (text rule), `mailbox_profiles.display_name`, `signature`, `writing_style` (text rule; exported). They land with the migration: the completeness tests read the DB columns.
- **Test:**
  1. The F106 completeness tests pass; with the `instruction` entry removed they fail.
  2. A data-request find for `jan@firma.pl` finds a request whose instruction holds it.
- **Done when:** the Proof prints `PROOF_OK`. After the land: the coordinator runs `bun run db:migrate` on the shared dev DB.
- **Out of scope:** repositories, retention, flag and switch (03b); any reader of the profile (04); the payload kind.
