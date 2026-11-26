# F115 stage 03b — Repositories, retention, flag and switch

Part of [`../plan.md`](../plan.md). Needs 03. No migration. Split from stage 03 in refresh 1 (review finding 9). The letter keeps the stage numbers that other tickets cite (F116 names F115 stages 04, 12, 15).

## Step 1 — Repositories

- **Goal:** in module `replies`, `repo/requests.ts` (insert, claim batch with `FOR UPDATE SKIP LOCKED` and `locked_at` as the triage claim, finish, release with `next_attempt_at`, list by email, count redrafts of a mail); in module `mail`, `mailboxProfileOf(db, ctx, mailboxId)` and `upsertMailboxProfile(trx, ctx, mailboxId, fields, userId)`.
- **Decisions:** a claim takes `pending` rows with `next_attempt_at <= now` and stale `drafting` rows (`locked_at` older than 5 min, one attempt counted). Every query filters by `org_id`.
- **Test (integration):**
  1. Two parallel claims of 4 pending rows → each row claimed once.
  2. A `drafting` row locked 6 min ago is claimed again with `attempts + 1`.
  3. `countRedrafts` counts only `redraft` rows of that mail.

## Step 2 — Retention

- **Goal:** a tenant-scoped clear function for `reply_requests.instruction` and `sample_body` in module `replies` (the pattern of `docs/code-patterns.md`: batches of 1 000 by id, `FOR UPDATE SKIP LOCKED`, a repeat run changes nothing), called by `apps/server/src/retention.ts` with the action payloads (`data_retention_days`). The retention log line adds one count (`reply text`). A row in `docs/architecture.md` §7.
- **Test (integration):**
  1. Retention clears an instruction of a request older than the window, and keeps a newer one.
  2. A second run changes nothing.

## Step 3 — Flag and switch

- **Goal:** the flag `reply_drafts` in `featureFlags` (epic `E6a`, remove-by `2027-06-01`, default off); the switch `reply_drafts` in the tool switch schema (default false) and the settings form list. The OAuth guard of the switch is stage 10.
- **Test:**
  1. `/api/me` flags list holds `reply_drafts: false` by default.
  2. A new mailbox has `tool_switches.reply_drafts` false.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** the profile in mail building (04), the switch route rules (10).

## Carry-over from the stage 03 review

- N6: pick ONE cut-off column for the retention of reply texts (`created_at` or `updated_at`) and one source (`data_retention_days` or `RETENTION_TEXT_DAYS`); make `docs/architecture.md` §7, the legal category `reply-texts` and `retention.ts` agree, with a test.
- N5: the `mailbox_profiles.signature` copy of `organizations.style_text` is a snapshot; decide the fallback order with stage 04/11.
