# s3-assist-actions — Stage 7

Part of [`../s3-assist-actions.md`](../s3-assist-actions.md). Read that file's "Input" and "Rules for every step" first.

## Stage 7 — Actions repository: claim, finish, release, fail; email location; fixtures [risky]

- [ ] **7.1 Claim queue and status changes in `actions/repo.ts`**
  - Goal: the committer, the Undo service, the returned job and the notice detector have typed, tenant-filtered queries with conditional updates (`locked_at` as the token, as in `claimEmails`).
  - Files: change `apps/server/src/modules/actions/repo.ts`, `apps/server/src/modules/actions/index.ts`, `apps/server/test/integration/actions-repo.test.ts`; change `packages/core/src/digest/would-do.ts` (`ActionView`), `packages/core/src/digest/would-do.test.ts`.
  - Interfaces:

    ```ts
    // packages/core would-do.ts
    export interface ActionView {
      id: string;
      type: ActionType;
      status: string;
      folder: FolderKey | null;
      reverse: boolean;
      reversesActionId: string | null;
      appliedAt: Date | null;
    }
    // describeActions skips rows with reverse === true (D14)

    // actions/repo.ts
    export const MAILBOX_ACTION_TYPES = ["move", "mark_read", "flag"] as const; // the types that change the mailbox
    export type ClaimFilter = { kind: "none" } | { kind: "synthetic" } | { kind: "all" }; // none = save_summary only
    export interface ClaimedAction {
      id: string;
      email_id: string;
      type: ActionType;
      payload: Record<string, string>;
      attempts: number;
      locked_at: Date;
      reverses_action_id: string | null;
      email: {
        id: string;
        mailbox_id: string;
        folder: string;
        uid: number;
        inbox_uid: number | null;
        message_id_header: string | null;
        content_hash: string;
        from_address: string | null;
        received_at: Date;
        subject: string | null;
      };
    }
    export async function countClaimable(
      db,
      ctx,
      mailboxId: string,
      opts: { now: Date; staleBefore: Date; filter: ClaimFilter }
    ): Promise<{ total: number; mailboxChanging: number }>;
    export async function claimActions(
      db,
      ctx,
      mailboxId: string,
      opts: { now: Date; limit: number; staleBefore: Date; filter: ClaimFilter }
    ): Promise<ClaimedAction[]>;
    export type FinishNext =
      | { status: "applied"; appliedAt: Date; providerResult?: Record<string, string | number | null> }
      | { status: "failed"; reason: string; lastError?: string };
    export async function finishAction(trx, ctx, id: string, lockedAt: Date, next: FinishNext): Promise<boolean>; // WHERE status = 'ready' AND locked_at = lockedAt
    export async function releaseAction(
      db,
      ctx,
      id: string,
      lockedAt: Date,
      opts: { nextAttemptAt: Date | null; countAttempt: boolean; lastError?: string }
    ): Promise<boolean>;
    export async function releaseActions(db, ctx, ids: readonly string[], lockedAt: Date): Promise<number>; // no count, next_attempt_at unchanged
    export async function markUndone(
      trx,
      ctx,
      originalId: string,
      opts: { at: Date; reason: "undo" | "user_moved_back" }
    ): Promise<boolean>; // WHERE status = 'applied'
    export interface UndoCandidate {
      id: string;
      type: ActionType;
      payload: Record<string, string>;
      status: string;
      appliedAt: Date | null;
      reverse: { id: string; status: string } | null;
    }
    export async function lockActionsForUndo(trx, ctx, emailId: string): Promise<UndoCandidate[]>; // originals of MAILBOX_ACTION_TYPES, FOR UPDATE, with their reverse row if any
    export async function insertReverse(
      trx,
      ctx,
      original: { id: string; emailId: string; type: ActionType; payload: Record<string, string> }
    ): Promise<string | null>; // status ready, idempotency_key `${id}:undo`; null when a reverse exists
    export async function latestOriginalMove(
      db,
      ctx,
      emailId: string
    ): Promise<{ id: string; status: string; reverseStatus: string | null } | undefined>; // newest original `move` by created_at, id
    export interface FailedAction {
      id: string;
      email_id: string;
      type: ActionType;
      reverse: boolean;
      status_reason: string | null;
      payload: Record<string, string>;
      subject: string | null;
      mailbox_id: string;
      from_address: string | null;
    }
    export async function listFailedUnnotified(db, ctx, opts: { since: Date; limit: number }): Promise<FailedAction[]>; // status failed, notified_at null, status_reason <> 'mail_not_found', updated_at >= since
    export async function markNotified(db, ctx, id: string, at: Date): Promise<boolean>; // WHERE notified_at IS NULL
    export async function countActionsSince(
      db,
      ctx,
      opts: { since: Date }
    ): Promise<{ applied: number; failed: number; undone: number }>; // for /status (stage 13)
    export const CLAIM_MAX_AGE_MS = 24 * 3_600_000; // D21
    export async function expireStaleReady(
      db,
      ctx,
      mailboxId: string,
      opts: { now: Date }
    ): Promise<{ id: string; type: ActionType }[]>; // ready originals of MAILBOX_ACTION_TYPES with created_at < now − CLAIM_MAX_AGE_MS and locked_at null or stale → status expired, status_reason stale; the caller audits
    // listActionsForEmails returns the grown ActionView
    ```

  - Decisions:
    - `claimActions`: `WITH picked AS (SELECT a.id FROM actions a JOIN emails e ON e.id = a.email_id AND e.org_id = a.org_id WHERE a.org_id = $org AND e.mailbox_id = $mb AND a.status = 'ready' AND (a.next_attempt_at IS NULL OR a.next_attempt_at <= $now) AND (a.locked_at IS NULL OR a.locked_at < $staleBefore) AND (a.type = 'save_summary' OR a.reverses_action_id IS NOT NULL OR a.created_at >= $now − CLAIM_MAX_AGE_MS) AND <filter> ORDER BY e.received_at, e.id, <type rank> LIMIT $limit FOR UPDATE OF a SKIP LOCKED) UPDATE actions a SET locked_at = $now FROM picked WHERE a.id = picked.id AND a.org_id = $org RETURNING …` plus a second select of the email fields (or one `UPDATE … FROM picked JOIN emails` with `RETURNING` of both). Type rank: `CASE a.type WHEN 'save_summary' THEN 0 WHEN 'flag' THEN 1 WHEN 'mark_read' THEN 2 WHEN 'move' THEN 3 END` (D6). Filter: `none` → `a.type = 'save_summary'`; `synthetic` → `a.type = 'save_summary' OR e.message_id_header ILIKE '%@ea-seed.test>'` (`mailKindFilter("synthetic")` from `mail`); `all` → true. `RETURNING` has no order: sort in code like `claimEmails`. `locked_at` = the JS `now`. The claim does not change `attempts` (D7).
    - `countClaimable`: the same `WHERE` without the lock; `mailboxChanging` counts types in `MAILBOX_ACTION_TYPES`.
    - `finishAction` sets `locked_at = null`, `next_attempt_at = null`, `updated_at = now()`; `applied` also sets `applied_at` and `provider_result`; `failed` sets `status_reason` and `last_error` (a `describeError` string, never a message). `releaseAction` keeps `status = 'ready'`, sets `locked_at = null`, `next_attempt_at`, and `attempts + 1` when `countAttempt`.
    - `lockActionsForUndo`: originals = rows with `reverses_action_id IS NULL AND type IN MAILBOX_ACTION_TYPES` of the mail, `FOR UPDATE`; the reverse rows by a second query (`reverses_action_id IN (…)`). `insertReverse`: `onConflict(["org_id", "idempotency_key"]).doNothing()`; `actions_reverse_key` also guards. The reverse payload is the original payload (`{ folder: <key> }` for a move) so readers know the folder.
    - `listFailedUnnotified` joins `emails` for `subject`, `mailbox_id`, `from_address` (the notice text needs the subject; the log never prints it).
    - Every function takes a `TenantContext` and filters by `org_id` on `actions` (and on `emails` in the joins).
  - Test (`actions-repo.test.ts`, `withRollback`; with the stage 7.2 fixtures): (1) `claimActions` returns the rows in order `received_at`, `id`, type rank, and sets `locked_at` = `now` exactly; a second claim in the same transaction returns nothing (locked and not stale); (2) filter `none` claims only `save_summary`; `synthetic` claims a synthetic mail's `flag` and a real mail's `save_summary`, not the real mail's `flag`; `all` claims both; (3) a row with `next_attempt_at` in the future is not claimed; a row with `locked_at` older than `staleBefore` is; (4) `finishAction` with the wrong `lockedAt` → false and no change; with the right one → `applied`, `applied_at`, `locked_at` null; `failed` sets `status_reason` and `last_error`; (5) `releaseAction` with `countAttempt` → `attempts` 1, `status` ready; `releaseActions` → `locked_at` null, `attempts` unchanged; (6) `markUndone` only from `applied` (false from `ready`); (7) `insertReverse` twice → the second returns null and only one reverse row exists; (8) `lockActionsForUndo` returns the originals with their reverse; (9) `latestOriginalMove` picks the newest original move and its reverse status; (10) `listFailedUnnotified` leaves out `mail_not_found` and notified rows; `markNotified` twice → true, then false; (10b) `expireStaleReady`: a `ready` `move` created 25 h ago → `expired` / `stale` and its id and type returned; a `ready` `move` created 1 h ago, a reverse row created 25 h ago and a `save_summary` created 25 h ago stay `ready`; `claimActions` never returns the 25-h-old original move; (11) tenant: every function with org B's ctx sees nothing of org A (one assertion per function); (12) two connections (own org, deleted at the end): connection 1 claims in an open transaction; connection 2's `claimActions` returns the other rows only (`SKIP LOCKED`); (13) `listActionsForEmails` returns `id`, `reverse`, `reversesActionId`, `appliedAt`; `describeActions` skips a reverse row and shows `undone: move to AI/Info` for an `undone` original (`would-do.test.ts`).
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: the committer (stage 8), the Undo service (stage 10).

- [ ] **7.2 Email location updates in `mail/repo.ts`, `openMailboxProvider`, fixtures**
  - Goal: the committer can record where a mail is, update a real folder path, and open a mailbox connection through the `mail` index; tests can build triaged mail with actions in one call.
  - Files: change `apps/server/src/modules/mail/repo.ts`, `apps/server/src/modules/mail/index.ts`, `apps/server/src/modules/mail/jobs.ts` (use the new open helper), `apps/server/src/modules/mail/tools.ts` (may use it), `apps/server/test/integration/mail-repo.test.ts`, `apps/server/test/integration/fixtures.ts`; create `apps/server/src/modules/mail/open.ts`.
  - Interfaces:

    ```ts
    // mail/repo.ts
    export async function updateEmailLocation(
      trx,
      ctx,
      emailId: string,
      next: { folder: string; uid: number; inboxUid?: number; movedAt: Date | null }
    ): Promise<boolean>;
    export async function setFolderMapEntry(
      trx,
      ctx,
      mailboxId: string,
      key: FolderKey,
      path: string
    ): Promise<boolean>; // jsonb_set on mailboxes.folder_map
    // mail/open.ts
    export interface OpenDeps {
      db;
      secrets: SecretBox;
      openProvider(opts: ImapConnectOptions): Promise<MailProvider>;
    }
    export async function openMailboxProvider(
      deps: OpenDeps,
      ctx,
      mailboxId: string
    ): Promise<{ provider: MailProvider; mailbox: MailboxRow }>; // loads the row and the credentials, decrypts in memory, opens; HardError when a row is missing
    // fixtures.ts
    export async function insertAction(
      trx,
      ctx,
      emailId: string,
      opts: {
        type: ActionType;
        status: string;
        payload?: Record<string, string>;
        idempotencyKey?: string;
        appliedAt?: Date | null;
        reversesActionId?: string | null;
        attempts?: number;
        nextAttemptAt?: Date | null;
        lockedAt?: Date | null;
        statusReason?: string | null;
        createdAt?: Date;
      }
    ): Promise<string>;
    export async function insertTriagedWithActions(
      trx,
      ctx,
      mailboxId: string,
      opts: Parameters<typeof insertTriaged>[3] & {
        folder?: string;
        uid?: number;
        inboxUid?: number | null;
        contentHash?: string;
        movedAt?: Date | null;
        actions: { type: ActionType; status: string; payload?: Record<string, string>; appliedAt?: Date | null }[];
      }
    ): Promise<{ emailId: string; actionIds: string[] }>;
    ```

  - Decisions:
    - `updateEmailLocation` sets `folder`, `uid`, `inbox_uid` when given, `moved_at` (null clears it after an Undo back to INBOX: the row then leaves the returned-check list). It never touches `status` or `returned_at`.
    - `openMailboxProvider` replaces the inline credential code in `mail/jobs.ts` (`syncOne`) and may replace `loadImapOptions` in `tools.ts`; the password lives only in the call frame. The `actions` module imports it from the `mail` index.
    - `insertTriagedWithActions` sets `content_hash` and `inbox_uid` (default: `uid`) so the committer's locate key matches a fake mail that the test delivers with the same `Message-ID`, `from`, `date` and body (the test computes the hash with `contentHash` from `sync-rules` on the fake's meta, or passes `contentHash`).
  - Test: `mail-repo.test.ts`: `updateEmailLocation` changes only the named columns and filters by `org_id`; `setFolderMapEntry` replaces one key and keeps the others; a `mail-open.test.ts` case with the fake `openProvider`: `openMailboxProvider` decrypts and passes host, port, user and the password to `openProvider` (the test captures the options) and throws `HardError` for a missing mailbox; `mail-jobs.test.ts` still passes.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass (user checkpoint 2 after the stage commit; group review of stages 2–7).
  - Out of scope: the committer.
