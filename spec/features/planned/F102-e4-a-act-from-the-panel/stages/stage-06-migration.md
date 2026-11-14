# F102 stage 06 — Migration [risky]

Part of [`../plan.md`](../plan.md). Read D1, D4, D14 and [`../commands.md`](../commands.md) § Data. Needs nothing. The only migration of this ticket: never next to another migration in build (`CLAUDE.md`).

`[risky]`: a migration. Two steps: the migration, then the core notice kind that the outbox CHECK and the core list must hold together.

## Step 1 — The migration [risky]

- **Goal:** the database can store a superseding action and an edit of an outbox row.
- **Files:** one new file in `db/migrations/` (the next timestamp at `HEAD`), the generated DB types (`bun run db:types`), one integration test.
- **Schema (up):**
  - `actions.supersedes_action_id uuid NULL`; `FOREIGN KEY (supersedes_action_id, org_id) REFERENCES actions (id, org_id)` (the shape of `depends_on_action_id`); `CREATE UNIQUE INDEX actions_supersedes_key ON actions (supersedes_action_id) WHERE supersedes_action_id IS NOT NULL` (a row is replaced at most once); `CHECK (supersedes_action_id IS NULL OR type IN ('create_draft', 'send'))`.
  - `outbox.edit_of_outbox_id uuid NULL REFERENCES outbox (id) ON DELETE CASCADE`, with an index where not null.
  - `outbox_kind_check`: the list at `HEAD` plus `'approval_edit'` (drop and add, as `…_mailbox_host_blocked.sql` does).
  - `outbox_approval_edit_check`: `CHECK ((kind = 'approval_edit') = (edit_of_outbox_id IS NOT NULL))`.
- **Down:** delete the `approval_edit` rows; drop the two CHECKs, the index, the columns; restore the old kind list. Old code ignores the new columns, so the deploy never needs the down step (stage 20).
- **Decisions:** D1, D4, D14. No backfill: every existing row has null. No change of `actions_type_check` (no new action type) or of the RLS policies (no new table; F092 policies cover the columns).
- **Test** (integration, `bun run test:int:ci` on the job DB):
  - T1: insert a `send` with `supersedes_action_id` = another send of the same organization: ok. A second row with the same `supersedes_action_id`: unique violation.
  - T2: `supersedes_action_id` = an action of another organization: FK violation.
  - T3: a `move` action with `supersedes_action_id` set: CHECK violation.
  - T4: an `approval_edit` outbox row without `edit_of_outbox_id`: CHECK violation; an `approval` row with it: CHECK violation; an `approval_edit` row with it: ok.
  - T5: deleting the target outbox row deletes the `approval_edit` row.
  - T6: the existing schema tests that compare CHECK lists with the code (`telegram-schema.test.ts`, `actions-transitions.test.ts`) pass after Step 2.
- **Done when:** T1–T6 pass; `bun run db:migrate` and then `bun run db:rollback` and `db:migrate` again run clean on the job DB.

## Step 2 — The `approval_edit` notice kind in core

- **Goal:** the core notice list, the view schema and the renderer know the new kind, so the CHECK and the code agree.
- **Files:** `packages/core/src/notices/kinds.ts`, `views.ts`, the registry and render code, their tests.
- **Interfaces:**
  - Kind `approval_edit` in `noticeKinds`.
  - Its view: a strict object with exactly the fields of the edit input that `renderNoticeEdit` takes (`original` card text, `outcome`, `at`, `timeZone`, and the optional `heldBy`, `actionId`). Outcomes allowed: `approved`, `approved_held`, `rejected`, `changed` (stage 05).
  - Its renderer: `renderNoticeEdit` of that view (Telegram, every detail level).
- **Test:**
  - T7: `registry.test.ts` passes with the new kind (every kind has a view schema and a renderer).
  - T8: a view `{ original: "📤 Send? …", outcome: "approved", at: "2026-11-20T13:05:00Z", timeZone: "Europe/Warsaw" }` renders the original plus `⏳ Approved 14:05, sending.` and no buttons.
  - T9: a view with outcome `expired` or an extra field fails the schema.
- **Done when:** T7–T9 pass.
- **Out of scope:** who queues and sends the rows (stage 09).

## Done when (stage)

- Steps 1 and 2 hold. The Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s06`).
- Owner step: none. Coordinator: after the land, `bun run db:migrate` on the shared dev DB (`CLAUDE.md`: shared runtime).
