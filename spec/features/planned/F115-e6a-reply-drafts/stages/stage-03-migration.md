# F115 stage 03 — Migration and repositories

Part of [`../plan.md`](../plan.md). `[risky]` (migration, privacy maps). The only migration of F115; no other migration may build next to it. Builds after gate G1.

## Step 1 — Migration

- **Goal:** one migration file with the tables, the index and the outbox kinds of `interfaces.md` § Data, then `bun run db:types`.
- **Decisions:**
  - `reply_requests` and `mailbox_profiles` as `interfaces.md`. CHECKs: `trigger IN ('auto','tap','redraft','sample')`; the status list; `char_length(instruction) <= 300`; profile lengths. Composite FKs `(email_id, org_id)` and `(mailbox_id, org_id)` → cascade; `previous_send_id` and `send_action_id` → `actions (id, org_id)` `ON DELETE SET NULL` (a data-request erase may delete actions). RLS as every org table (copy the policy shape of the newest table).
  - `INSERT INTO mailbox_profiles (mailbox_id, org_id, signature) SELECT m.id, m.org_id, NULLIF(o.style_text, '') FROM mailboxes m JOIN organizations o …` (expand step, D13). `organizations.style_text` stays (E6b drops it).
  - Index `emails (mailbox_id, thread_key, received_at)` (F5); `CREATE INDEX` in the migration, as earlier index migrations do.
  - Outbox kinds `replies_ready`, `reply_prompt`, `reply_result` in `outbox_kind_check` (drop and add, as `20261115130001_approval_edit.sql`); the `down` part deletes their rows first. `replies_ready` needs no `email_id`; `reply_prompt` and `reply_result` need `email_id`.
- **Test (integration):**
  1. Migrate up on a DB with an org whose `style_text` is `"Jan"` and one with `''`: profiles have signature `"Jan"` and null.
  2. A second `auto` request for the same mail → unique violation; a second `tap` request → allowed.
  3. Org B cannot read org A's `reply_requests` row under the tenant role (RLS).
  4. Down, then up again: no error.

## Step 2 — Repositories

- **Goal:** in module `replies`, `repo/requests.ts` (insert, claim batch with `FOR UPDATE SKIP LOCKED` and `locked_at` as the triage claim, finish, release with `next_attempt_at`, list by email, count redrafts of a mail); in module `mail`, `mailboxProfileOf(db, ctx, mailboxId)` and `upsertMailboxProfile(trx, ctx, mailboxId, fields, userId)`.
- **Decisions:** a claim takes `pending` rows with `next_attempt_at <= now` and stale `drafting` rows (`locked_at` older than 5 min, one attempt counted). Every query filters by `org_id`.
- **Test (integration):**
  1. Two parallel claims of 4 pending rows → each row claimed once.
  2. A `drafting` row locked 6 min ago is claimed again with `attempts + 1`.
  3. `countRedrafts` counts only `redraft` rows of that mail.

## Step 3 — Privacy maps, retention and the registries

- **Goal:** the F106 address map (`privacy/address-map.ts`) and export map gain the new text columns: `reply_requests.instruction` (text rule), `reply_requests.sample_body` (text rule), `mailbox_profiles.display_name`, `signature`, `writing_style` (text rule; exported). The completeness test passes. Retention: `reply_requests.instruction` and `sample_body` clear with the action payloads (`data_retention_days`), and the retention log line adds one count (`reply text`).
- **Also:** the flag `reply_drafts` in `featureFlags` (epic `E6a`, remove-by `2027-06-01`, default off); the switch `reply_drafts` in the tool switch schema (default false) and the settings form list.
- **Test:**
  1. The F106 completeness test passes; with the `instruction` entry removed it fails.
  2. A data-request find for `jan@firma.pl` finds a request whose instruction holds it.
  3. Retention clears an instruction of a request older than the window, and keeps a newer one.
  4. `/api/me` flags list holds `reply_drafts: false` by default.
- **Check:** `bun test` on the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`. After the land: the coordinator runs `bun run db:migrate` on the shared dev DB.
- **Out of scope:** any reader of the profile in mail building (stage 04), the payload kind.
