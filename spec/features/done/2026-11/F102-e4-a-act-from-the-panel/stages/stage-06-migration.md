# F102 stage 06 — Migration and the edit notice kind [risky]

Part of [`../plan.md`](../plan.md). Read D1, D4, D14 and [`../commands.md`](../commands.md) § Data. Needs stage 05 landed (outcome `changed`). The only migration of this ticket: never next to another migration in build.

`[risky]`: a migration. Two steps: the migration, then the kind with its producer (`docs/code-patterns.md` § "Add a notice kind": CHECK, core kind and producer change together).

## Step 1 — The migration [risky]

- **Goal:** the database can store a superseding action and an edit of an outbox row.
- **Files:** one new file in `db/migrations/` (the next timestamp at `HEAD`), the generated DB types (`bun run db:types`), one integration test.
- **Schema (up):**
  - `actions.supersedes_action_id uuid NULL`; `FOREIGN KEY (supersedes_action_id, org_id) REFERENCES actions (id, org_id)`; `CREATE UNIQUE INDEX actions_supersedes_key ON actions (supersedes_action_id) WHERE supersedes_action_id IS NOT NULL`; `CHECK (supersedes_action_id IS NULL OR type IN ('create_draft', 'send'))`.
  - `outbox.edit_of_outbox_id uuid NULL REFERENCES outbox (id) ON DELETE CASCADE`, indexed where not null.
  - `outbox_kind_check`: the list at `HEAD` plus `'approval_edit'` (drop and add).
  - `outbox_approval_edit_check`: `CHECK ((kind = 'approval_edit') = (edit_of_outbox_id IS NOT NULL))`, and `CHECK (kind <> 'approval_edit' OR email_id IS NOT NULL)`.
- **Down:** delete the `approval_edit` rows, then drop the CHECKs, the index and the columns, and restore the old kind list. The deploy never needs it (stage 20).
- **Decisions:** no backfill; no change of `actions_type_check` or of the RLS policies (no new table).
- **Test** (integration):
  - T1: a `send` with `supersedes_action_id` = another send of the same organization: ok; a second row with the same value: unique violation.
  - T2: `supersedes_action_id` of another organization: FK violation. A `move` action with it set: CHECK violation.
  - T3: an `approval_edit` row without `edit_of_outbox_id`, or without `email_id`: CHECK violation; an `approval` row with `edit_of_outbox_id`: CHECK violation.
  - T4: deleting the target outbox row deletes its `approval_edit` rows.
- **Done when:** T1–T4 pass; `db:migrate`, `db:rollback`, `db:migrate` run clean on the job DB.

## Step 2 — Kind `approval_edit` and `queueCardEdits`

- **Goal:** the code knows the kind, and one function queues the card edits of a send.
- **Files:** `packages/core/src/notices/` (kind, view, renderer), `apps/server/src/modules/privacy/outbox.ts` (`NOTICE_MAIL_CONTENT`), a new `channels/card-edits.ts` with its `queuedBy` entry, `queueNotice` (one optional input), tests.
- **Interfaces:**
  - Kind `approval_edit`. Its view: strict, exactly `{ original, outcome, at, timeZone, heldBy?, actionId? }`, the input of `renderNoticeEdit`; outcomes `approved`, `approved_held`, `rejected`, `changed`, `expired`. Renderer: `renderNoticeEdit`.
  - `queueCardEdits(trx, ctx, { sendId, outcome, heldBy?, exceptUserId?, at })` (`commands.md`).
- **Decisions:**
  - D4 exception, written in the view comment: `original` is the target card's stored text, as the tap edit uses it (`docs/code-patterns.md`: "the edit after a tap keeps the stored text"). Stage 19 adds this exception to the patterns.
  - For each outbox row of the organization with dedup `approval:<sendId>`: `sent` with a text and a message id, user ≠ `exceptUserId` → one row via `queueNotice` with the target's user, locale, channel, detail and `email_id`, `edit_of_outbox_id` = target, dedup `approval_edit:<target id>:<outcome>`; `pending` → `failed` / `answered_elsewhere`; `sending` → nothing (accepted race).
  - `approved_held` sets `actionId` = `sendId`, so other owners' cards keep Reject (as the tapper's card, Q13).
  - `NOTICE_MAIL_CONTENT.approval_edit` = `one_mail` (the row carries the target's `email_id`).
  - `approval_set:` cards: no edit (Q15).
- **Test** (core unit and server integration; owners U1, U2 with sent cards C1, C2 of send S1; `2026-11-20T13:05:00Z`, `Europe/Warsaw`):
  - T5: core: the view `{ original: "📤 Send? …", outcome: "approved", at, timeZone }` renders the original plus `⏳ Approved 14:05, sending.` with no buttons; an extra field fails.
  - T6: `queueCardEdits(S1, approved)` → rows for C1 and C2; with `exceptUserId` U1 → C2 only.
  - T7: C2 `pending` → C2 `failed` / `answered_elsewhere`; one row (C1).
  - T8: `approved_held` then `rejected` → two rows per card (different dedup); the same outcome twice → no new row.
  - T9: a card of organization O2 is never read for O1.
  - T10: both registry tests and `telegram-schema.test.ts` pass.
- **Done when:** T5–T10 pass.
- **Out of scope:** callers and the sender (stage 09).

## Done when (stage)

- Steps 1 and 2 hold. The Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s06`).
- Coordinator: after the land, `bun run db:migrate` on the shared dev DB.
