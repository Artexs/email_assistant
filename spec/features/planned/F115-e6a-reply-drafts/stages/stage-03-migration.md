# F115 stage 03 — Migration and repositories

Part of [`../plan.md`](../plan.md). `[risky]` (migration, privacy maps). The only migration of F115; no other migration may build next to it. Builds after gate G1.

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
  5. `bun run db:check-migrations` passes.

## Step 2 — Repositories

- **Goal:** in module `replies`, `repo/requests.ts` (insert, claim batch with `FOR UPDATE SKIP LOCKED` and `locked_at` as the triage claim, finish, release with `next_attempt_at`, list by email, count redrafts of a mail); in module `mail`, `mailboxProfileOf(db, ctx, mailboxId)` and `upsertMailboxProfile(trx, ctx, mailboxId, fields, userId)`.
- **Decisions:** a claim takes `pending` rows with `next_attempt_at <= now` and stale `drafting` rows (`locked_at` older than 5 min, one attempt counted). Every query filters by `org_id`.
- **Test (integration):**
  1. Two parallel claims of 4 pending rows → each row claimed once.
  2. A `drafting` row locked 6 min ago is claimed again with `attempts + 1`.
  3. `countRedrafts` counts only `redraft` rows of that mail.

## Step 3 — Privacy maps, retention and the registries

- **Goal:** the F106 address map (`privacy/address-map.ts`) and export map gain the new text columns: `reply_requests.instruction` (text rule), `reply_requests.sample_body` (text rule), `mailbox_profiles.display_name`, `signature`, `writing_style` (text rule; exported). The completeness test passes. Retention: `reply_requests.instruction` and `sample_body` clear with the action payloads (`data_retention_days`), and the retention log line adds one count (`reply text`).
- **Rollback safety (refresh 1):** `renderNotice` (`core/notices/render.ts`) throws today on a kind without a renderer. Make it answer `{ ok: false }` (the sender then fails the row `bad_view` and goes on), so a release with this stage is a safe rollback target for the stages that write the new kinds. Unit test: an unknown kind → `{ ok: false }`.
- **Also:** the flag `reply_drafts` in `featureFlags` (epic `E6a`, remove-by `2027-06-01`, default off); the switch `reply_drafts` in the tool switch schema (default false) and the settings form list.
- **Test:**
  1. The F106 completeness test passes; with the `instruction` entry removed it fails.
  2. A data-request find for `jan@firma.pl` finds a request whose instruction holds it.
  3. Retention clears an instruction of a request older than the window, and keeps a newer one.
  4. `/api/me` flags list holds `reply_drafts: false` by default.
- **Done when:** the Proof prints `PROOF_OK`. After the land: the coordinator runs `bun run db:migrate` on the shared dev DB.
- **Out of scope:** any reader of the profile in mail building (stage 04), the payload kind.
