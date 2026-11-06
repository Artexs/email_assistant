# s3-assist-actions — Stage 10

Part of [`../s3-assist-actions.md`](../s3-assist-actions.md). Read that file's "Input" and "Rules for every step" first.

## Stage 10 — Undo service and reverse actions [risky]

- [ ] **10.1 `undo(emailId)` creates the reverse rows (D10)**
  - Goal: one call turns every undoable action of a mail into a reverse action that the committer applies; a second call does nothing; the window is 7 days.
  - Files: create `apps/server/src/modules/actions/undo.ts`, `apps/server/test/integration/actions-undo.test.ts`; change `apps/server/src/modules/actions/index.ts`, `apps/server/src/modules/mail/repo.ts` (`emailExists(db, ctx, emailId): Promise<boolean>`), `apps/server/src/modules/mail/index.ts`; create `packages/core/src/digest/undo.ts` (`UNDO_WINDOW_MS = 7 * 24 * 3_600_000`, `isUndoable(actions: readonly ActionView[], now: Date): boolean`), `packages/core/src/digest/undo.test.ts`; change `packages/core/src/digest/index.ts`.
  - Interfaces:

    ```ts
    export type UndoResult =
      | { kind: "started"; created: number }
      | { kind: "already" } // a reverse row exists (any status) or the originals are undone
      | { kind: "nothing" } // no applied mailbox action
      | { kind: "too_old" } // applied, but applied_at older than UNDO_WINDOW_MS
      | { kind: "not_found" }; // no such mail in this organization
    export async function undo(
      db: Db | Transaction<DB>,
      ctx: TenantContext,
      emailId: string,
      opts: { now: Date; userId: string }
    ): Promise<UndoResult>;
    // core
    export function isUndoable(actions: readonly ActionView[], now: Date): boolean; // an original (reverse false) of type move | flag | mark_read, status applied, appliedAt within UNDO_WINDOW_MS, and no row with reversesActionId === its id
    ```

  - Decisions:
    - One transaction: `emailExists` false → `not_found` (the same answer for an unknown id and another organization's id). `candidates = lockActionsForUndo(trx, ctx, emailId)`. `undoable` = candidates with `status === "applied"`, `reverse === null`, `appliedAt >= now − UNDO_WINDOW_MS`. For each: `insertReverse` (null = a race lost: count it as existing), audit `action.undo_requested` (`actor: userId`, `data: { original_action_id, reverse_action_id, action_type }`). `created > 0` → `started`. Else: any candidate with `reverse !== null` or `status === "undone"` → `already`; any `applied` candidate older than the window → `too_old`; else `nothing`.
    - The user id in the audit row is the caller's (the Telegram link's user); the reverse rows have `actor: system` when the committer applies them.
    - The service writes no feedback (the caller does, D10): the service is also the future API route's.
    - `isUndoable` is pure and shared by the digest renderer (stage 13) and tests; `undo` uses the same window constant.
  - Test:
    - `undo.test.ts` (core): applied move within the window → true; with a reverse row present → false; applied 8 days ago → false; only `save_summary` applied → false; `logged` → false; an `undone` original → false.
    - `actions-undo.test.ts` (`withRollback`, fixtures): (1) a mail with `applied` `mark_read` + `move` (applied 1 h ago) and `applied` `save_summary` → `started` with `created` 2; two reverse rows `ready` with `reverses_action_id`, `idempotency_key` `<id>:undo`, the original payloads; two `action.undo_requested` rows with `actor` = the user; (2) the same call again → `already`, still two reverse rows; (3) one original `undone` already and the other with a reverse → `already`; (4) only `save_summary` → `nothing`; (5) applied 8 days ago → `too_old`; one applied 8 days ago and one 1 h ago → `started` with 1; (6) org B's mail id and a random uuid → `not_found`, no rows; (7) end to end with the committer (fake, `keepUidOnCopy`): a mail moved to `AI/Info`, flagged and marked read by the committer (run 1) → `undo` → committer run 2 → the mail is in INBOX without `\\Flagged` and `\\Seen`; the three originals `undone` / `undo`, the three reverses `applied`, `emails.folder` INBOX, `moved_at` null; audit rows: three `action.applied` for the reverses, three `action.undone`; (8) the order of the reverse rows in the claim: flag and mark_read before the move (the flags act on the AI-folder UID, then the move); check `fake.calls` order `setFlags`, `setFlags`, `moveMessage`.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: the button and the feedback row (stage 13), the returned job (stage 11).
