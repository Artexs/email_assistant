# F116 stage 09 — Action anchor on a loop

Part of [`../plan.md`](../plan.md). `[risky]` (migration on `actions`, the committer's table). Needs stage 08. The second migration: no other migration in build next to it. Owner step after the land: `bun run db:migrate` on the dev DB.

A follow-up answers the user's own sent mail, so it has no incoming mail to hang on (F2, D4). This stage makes the second anchor possible and keeps every current path as it is. Stages 10–11 open the paths for loop rows.

## Step 1 — Migration

- **Goal:** `db/migrations/<stamp>_action_loop_anchor.sql` with its down part.
- **Decisions:**
  - `actions.email_id` drops NOT NULL; new `actions.loop_id uuid`, FK `(loop_id, org_id)` → `open_loops (id, org_id)` `ON DELETE CASCADE` (a loop row goes only with its mailbox or organization; then its actions go too, like the mail cascade of `email_id`).
  - CHECK `(email_id IS NULL) <> (loop_id IS NULL)`; CHECK `loop_id IS NULL OR type IN ('create_draft', 'send')`.
  - Partial index `(org_id, loop_id) WHERE loop_id IS NOT NULL`.
  - `outbox.loop_id` (same FK and cascade); `outbox_email_kind_check` becomes "`email_id` or `loop_id` is not null" for the kinds that need a mail today (an `approval`, `approval_set` or `send_result` row of a follow-up carries the loop). Same rule for the latest form of the check at `HEAD` (F102 added `approval_edit`).
  - The down part fails when a loop row exists (no silent delete).
- **Test (integration):** T1 up, down, up on an empty job DB; T2 a row with both anchors null → CHECK error, both set → error; T3 a `move` row with a `loop_id` → error; an `approval` outbox row with neither id → error, with only `loop_id` → stored; T4 the down part with one loop-anchored row → error, the row stays.

## Step 2 — Types and the guard

- **Goal:** `platform/db/schema.ts` types `email_id: string | null` and `loop_id: string | null`; typecheck passes with no change of behaviour.
- **Interfaces (new, module `actions`):** `ActionAnchor = { kind: "email", emailId } | { kind: "loop", loopId }` and `anchorOfRow(row) → ActionAnchor`; `emailIdOf(row) → string` throws `ActionAnchorError("loop_anchor")` for a loop row. Code paths that only exist for incoming mail (mailbox changes, Undo, triage planning, delegation, clarification, reminder, the activity of a mail) use `emailIdOf`.
- **Decisions:**
  - Every reader that joins `emails` keeps its inner join; until stages 10–11 the claim, the approval list and read model (F102), the approval and approval-set card detectors, the expiry jobs and the send-result notice add an explicit `email_id IS NOT NULL`, so a loop row is invisible to them. Each such place gets a one-line comment `// loop rows: F116 stage 10/11`.
  - No new action type and no new draft kind here.
- **Test (integration):** T5 a hand-inserted loop-anchored `create_draft` + `send` pair (status `ready` / `awaiting_approval`) is not claimed, not in `GET /approvals`, gets no card and is not expired by the 48 h job; T6 `emailIdOf` on that row throws `loop_anchor`; T7 the full unit and integration suites pass unchanged (the Proof).

## Check

`bun run typecheck` and `bun test apps/server/test/integration/actions-*.test.ts`

## Done when

T1–T7 pass; the final message lists each place that got the `email_id IS NOT NULL` filter; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s09`).

## Out of scope

The follow-up kind and the claim of loop rows (10), cards (11).
