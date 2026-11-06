# s3-assist-actions — Stage 10

Part of [`../s3-assist-actions.md`](../s3-assist-actions.md). Read that file's "Input" and "Rules for every step" first.

## Stage 10 — Undo service and reverse actions [risky]

- [ ] **10.1 `undo(emailId)` creates the reverse rows (D10)**
  - Goal: one call turns every undoable action of a mail into a reverse action that the committer applies; a second call does nothing; the window is 7 days; a tap that the scope or a pause would hold back creates nothing; a `ready` original of the mail never runs after the Undo.
  - Files: create `apps/server/src/modules/actions/undo.ts`, `apps/server/src/modules/actions/expire.ts`, `apps/server/test/integration/actions-undo.test.ts`; change `apps/server/src/modules/actions/index.ts`, `apps/server/src/modules/actions/scope.ts` (`scopeAdmits`), `apps/server/src/modules/actions/scope.test.ts`, `apps/server/src/modules/mail/repo.ts` (`getEmailMailbox`), `apps/server/src/modules/mail/index.ts`; create `packages/core/src/digest/undo.ts` (`UNDO_WINDOW_MS = 7 * 24 * 3_600_000`, `isUndoable(actions: readonly ActionView[], now: Date): boolean`), `packages/core/src/digest/undo.test.ts`; change `packages/core/src/digest/index.ts`.
  - Interfaces:

    ```ts
    export type UndoResult =
      | { kind: "started"; created: number }
      | { kind: "already" } // a reverse row exists (any status) or the originals are undone
      | { kind: "nothing" } // no applied mailbox action
      | { kind: "too_old" } // applied, but applied_at older than UNDO_WINDOW_MS
      | { kind: "held" } // undoable, but ACTIONS_SCOPE or the mailbox status would hold the reverse back (M9, Q5 default)
      | { kind: "not_found" }; // no such mail in this organization
    export async function undo(
      db: Db | Transaction<DB>,
      ctx: TenantContext,
      emailId: string,
      opts: { now: Date; userId: string; scope: ActionsScope }
    ): Promise<UndoResult>;
    // scope.ts
    export function scopeAdmits(filter: ClaimFilter, messageIdHeader: string | null): boolean; // all → true; synthetic → isSyntheticMessageId; none → false
    // expire.ts (shared by undo, the expire-ready CLI and the settings setters of stage 14, which get it as SettingsDeps.expireReady: config never imports actions, D16)
    export async function expireReady(
      trx: Transaction<DB>,
      ctx: TenantContext,
      filter: ExpireFilter,
      opts: { now: Date; reason: "policy_changed" | "undo" | "manual"; actor: string }
    ): Promise<{ id: string; emailId: string; type: ActionType }[]>; // expireReadyOriginals (staleBefore = now − STALE_AFTER_MS) + one action.expired audit row per row
    // mail/repo.ts (replaces the emailExists of the first plan)
    export async function getEmailMailbox(
      db,
      ctx,
      emailId: string
    ): Promise<
      | { mailboxId: string; mailboxAddress: string; mailboxStatus: MailboxStatus; messageIdHeader: string | null }
      | undefined
    >; // undefined = no such mail in this org
    // core
    export function isUndoable(actions: readonly ActionView[], now: Date): boolean; // an original (reverse false) of type move | flag | mark_read, status applied, appliedAt within UNDO_WINDOW_MS, and no row with reversesActionId === its id
    ```

  - Decisions:
    - One transaction: `mail = getEmailMailbox` undefined → `not_found` (the same answer for an unknown id and another organization's id). `candidates = lockActionsForUndo(trx, ctx, emailId)` (row locks on the originals: the returned job takes the same lock, stage 11, M8). `undoable` = candidates with `status === "applied"`, `reverse === null`, `appliedAt >= now − UNDO_WINDOW_MS`.
    - Held check (M9, Q5 default), only when `undoable` is not empty: `applies = mail.mailboxStatus === "active" && scopeAdmits(claimFilterFor(opts.scope, mail.mailboxAddress), mail.messageIdHeader)`. `applies` false → `held`, nothing written. Why: under `ACTIONS_SCOPE=off`, a scope that does not admit the mail, or a paused or `auth_error` mailbox, the committer never claims the reverse, so the toast "the mail goes back within a minute" would be false and the reverse would run days later. Alternative (if the user answers Q5 otherwise): drop the held check and let reverse rows of an applied original pass every scope in `claimActions`.
    - For each undoable candidate: `insertReverse` (null = a race lost: count it as existing), audit `action.undo_requested` (`actor: userId`, `actionId` = the original's id, `emailId`, `data: { original_action_id, reverse_action_id, action_type }`). `created > 0` → also `expireReady(trx, ctx, { mailboxId: mail.mailboxId, emailId, types: MAILBOX_ACTION_TYPES }, { now, reason: "undo", actor: userId })` (m13: a `ready` original in a hard-error retry wait would move the mail again after the Undo) → `started`. A `ready` original that a committer run holds now (a fresh `locked_at`) is not expired (stage 7.1b): it finishes `applied` after the toast, and the next digest shows ↩️ again for it. This is accepted and written in the runbook (D10, re-review Rm8); no code handles it. Else: any candidate with `reverse !== null` or `status === "undone"` → `already`; any `applied` candidate older than the window → `too_old`; else `nothing`.
    - `expireReady` writes one `action.expired` audit row per expired row (`actor`, `actionId`, `emailId`, `reasonCode` = the reason, `data: { action_type }`), in the caller's transaction. It takes a `Transaction<DB>`: every caller holds one.
    - The user id in the audit row is the caller's (the Telegram link's user); the reverse rows have `actor: system` when the committer applies them.
    - The service writes no feedback (the caller does, D10): the service is also the future API route's.
    - `isUndoable` is pure and shared by the digest renderer (stage 13) and tests; `undo` uses the same window constant.
  - Test:
    - `undo.test.ts` (core): applied move within the window → true; with a reverse row present → false; applied 8 days ago → false; only `save_summary` applied → false; `logged` → false; an `undone` original → false.
    - `scope.test.ts` (unit): `scopeAdmits` for each filter with a synthetic and a real `Message-ID` and with null.
    - `actions-undo.test.ts` (`withRollback`, fixtures; `scope` = `{ kind: "all", mailboxAddress: <the fixture mailbox address> }` unless said otherwise): (1) a mail with `applied` `mark_read` + `move` (applied 1 h ago) and `applied` `save_summary` → `started` with `created` 2; two reverse rows `ready` with `reverses_action_id`, `idempotency_key` `<id>:undo`, the original payloads; two `action.undo_requested` rows with `actor` = the user; (2) the same call again → `already`, still two reverse rows; (3) one original `undone` already and the other with a reverse → `already`; (4) only `save_summary` → `nothing`; (5) applied 8 days ago → `too_old`; one applied 8 days ago and one 1 h ago → `started` with 1; (6) org B's mail id and a random uuid → `not_found`, no rows; (6b) held (M9): scope `off` → `held`, no reverse row, no audit row; scope `synthetic` with a real mail → `held`; the mailbox `paused` with scope `all` → `held`; (6c) m13: an applied `move` and a `ready` `flag` original in a retry wait (`next_attempt_at` in the future) → `started`; the `flag` is `expired` / `undo` with an `action.expired` audit row; (7) end to end with the committer (fake, `keepUidOnCopy`): a mail moved to `AI/Info`, flagged and marked read by the committer (run 1) → `undo` → committer run 2 → the mail is in INBOX without `\\Flagged` and `\\Seen`; the three originals `undone` / `undo`, the three reverses `applied`, `emails.folder` INBOX, `moved_at` null; audit rows: three `action.applied` for the reverses, three `action.undone`; (8) the order of the reverse rows in the claim: flag and mark_read before the move (the flags act on the AI-folder UID, then the move); filter `fake.calls` to `setFlags` and `moveMessage` (the locates also add `fetchMetaIn` and `searchSinceIn` calls), then expect `setFlags`, `setFlags`, `moveMessage`.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: the button and the feedback row (stage 13), the returned job (stage 11).
