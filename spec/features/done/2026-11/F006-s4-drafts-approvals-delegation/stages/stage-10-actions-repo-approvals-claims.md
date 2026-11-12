# s4-drafts-approvals-delegation — Stage 10

Part of [`../plan.md`](../plan.md). Read that file's "Input" and "Rules for every step" first.

## Stage 10 — Actions repository: claims with scopes, approvals, send-again, expiry and notice queries, fixtures [risky]

Why risky: the claim query is the gate between an approval row and an SMTP call; the approval functions are the only way a send becomes `approved`. Every update here is conditional and tenant-filtered.

- [x] **10.1 Claims for drafts and sends, the scope filters, `markApplying`, the fixtures (D16, D17, D33)**
  - Goal: the committer claims drafts (`ready`, only while their send waits), approved sends whose draft is applied, and released or stale `applying` rows for recovery (an `applying` draft also after its send ended: the apply step then removes or expires it, D12); the scopes hold rows back in SQL; no row is stuck for ever; the committer can count the sends the scope holds; tests can build a draft-and-send pair in one call.
  - Files: change `apps/server/src/modules/actions/repo.ts`, `actions/index.ts`, `actions/scope.ts` (S3 stage 8.2), `actions/scope.test.ts`, `actions/undo.ts` (`scopeAdmits` call, `undo.ts:45`), `actions/committer.ts` (the filter build at `:208` and `warnWhenHeldBack` at `:123-133`), `actions/apply.ts` (`apply.ts:263` reads `action.payload.folder` into `isFolderKey(value: string | undefined)`, `apply.ts:251`: M4), `apps/server/src/modules/channels/notices.ts` (`:121` reads `FailedAction.payload.folder` into `Object.hasOwn(AI_FOLDER_NAMES, key)`: M4), `apps/server/test/integration/actions-repo.test.ts`, the S3 tests that build a `ClaimFilter` (`actions-repo.test.ts:174` `ALL` and the `claimOpts` calls at `:268`, `:273`; `actions-apply.test.ts:116`; `actions-move.test.ts:117`; `actions-undo.test.ts:450`), `apps/server/test/integration/fixtures.ts`.
  - Interfaces:

    ```ts
    // scope.ts
    export type SendScope =
      | { kind: "off" }
      | { kind: "self"; addresses: string[] }
      | { kind: "all"; mailboxAddress: string };
    export type SendClaimFilter = { kind: "none" } | { kind: "self"; addresses: string[] } | { kind: "all" };
    export function sendFilterFor(scope: SendScope, mailboxAddress: string): SendClaimFilter; // off → none; self → self (lower-cased list); all → the mailbox address matches ? all : none
    export function sendScopeAdmits(filter: SendClaimFilter, to: readonly string[]): boolean; // pure; the Telegram handler uses it for the "held" answer (stage 16)
    export type MailboxClaimFilter = { kind: "none" } | { kind: "synthetic" } | { kind: "all" }; // the S3 ClaimFilter union (`repo.ts:146`), renamed
    export interface ClaimFilter {
      mailbox: MailboxClaimFilter;
      send: SendClaimFilter;
    } // the S3 ClaimFilter becomes the `mailbox` part
    export function claimFilterFor(scope: ActionsScope, mailboxAddress: string): MailboxClaimFilter; // S3 `scope.ts:9`: returns the `mailbox` part (body unchanged)
    export function scopeAdmits(filter: MailboxClaimFilter, messageIdHeader: string | null): boolean; // S3 `scope.ts:16`: takes the `mailbox` part (body unchanged)
    // repo.ts
    export interface ClaimedAction {
      id: string;
      email_id: string;
      type: ActionType;
      status: "ready" | "approved" | "applying";
      payload: Record<string, unknown>;
      attempts: number;
      locked_at: Date;
      created_at: Date;
      reverses_action_id: string | null;
      original_created_at: Date | null;
      depends_on_action_id: string | null;
      outgoing_message_id: string | null;
      approved_at: Date | null;
      provider_result: Record<string, unknown> | null;
      email: {
        id;
        mailbox_id;
        folder;
        uid;
        inbox_uid;
        message_id_header;
        content_hash;
        from_address;
        to_addresses: string[];
        subject;
        received_at;
        body_text: string | null;
        in_reply_to: string | null;
        references_header: string | null;
        thread_key: string;
      };
    }
    // FailedAction (S3 `repo.ts:540`): payload widens from Record<string, string> to Record<string, unknown> (D33)
    // UndoCandidate (S3 `repo.ts:441`): payload stays Record<string, string> (the Undo reads only `move` rows; M4)
    export async function claimActions(
      db,
      ctx,
      mailboxId,
      opts: { now: Date; limit: number; staleBefore: Date; filter: ClaimFilter }
    ): Promise<ClaimedAction[]>;
    export async function countClaimable(
      db,
      ctx,
      mailboxId,
      opts
    ): Promise<{ total: number; mailboxChanging: number; sending: number }>;
    export async function countHeldSends(db, ctx, mailboxId, opts: { send: SendClaimFilter }): Promise<number>; // approved sends of the mailbox, draft applied, that the send filter does not admit (no lock rule)
    export async function markApplying(
      db,
      ctx,
      id: string,
      lockedAt: Date,
      opts?: { outgoingMessageId?: string }
    ): Promise<boolean>; // WHERE status IN ('ready', 'approved') AND locked_at = lockedAt → applying (locked_at kept)
    // The S3 fields stay (review round 3: the S3 code is in git, `actions/repo.ts:313`): `at` is the run clock on every
    // variant (it sets `updated_at`, and `applied_at` for `applied`); `countAttempt` on `failed` counts the try that failed.
    export type FinishNext =
      | { status: "applied"; at: Date; providerResult?: Record<string, string | number | boolean | null> }
      | {
          status: "failed";
          at: Date;
          reason: string;
          lastError?: string;
          countAttempt?: true;
          providerResult?: Record<string, string | number | boolean | null>; // S4: a send failure stores { stage, response_code, code } for the result notice (D20)
        }
      | { status: "expired"; at: Date; reason: "send_closed" }; // S4: an `applying` draft whose send ended before the APPEND (stage 11.1, N12)
    export async function finishAction(
      trx,
      ctx,
      id,
      lockedAt,
      next: FinishNext,
      opts?: { from?: readonly ("ready" | "approved" | "applying")[] }
    ): Promise<boolean>; // default from: ['ready', 'applying']
    export async function releaseAction(
      db,
      ctx,
      id,
      lockedAt,
      opts: {
        toStatus: "ready" | "approved" | "applying"; // S4
        nextAttemptAt: Date | null;
        countAttempt: boolean;
        now: Date; // S3 (`repo.ts:361`); the short forms `releaseAction({ … })` in the stage texts always pass it
        lastError?: string;
      }
    ): Promise<boolean>; // S3 callers pass toStatus "ready"
    export async function updateProviderResult(db, ctx, id, patch: Record<string, unknown>): Promise<boolean>; // jsonb merge; for the Sent copy outcome after `applied`
    // fixtures.ts
    export async function insertDraftAndSend(
      trx,
      ctx,
      mailboxId,
      opts: {
        kind?: "delegation" | "clarification" | "reminder";
        draftStatus?: string;
        sendStatus?: string;
        to?: string;
        delegateId?: string;
        delegateName?: string;
        task?: string;
        dueDate?: string;
        language?: "pl" | "en";
        approved?: { userId: string; at: Date };
        notifiedAt?: Date | null;
        createdAt?: Date;
        lockedAt?: Date | null;
        draftProviderResult?: Record<string, unknown>;
        outgoingMessageId?: string | null;
        messageId?: string | null;
        subject?: string;
        from?: string;
        bodyText?: string;
        inReplyTo?: string | null;
        referencesHeader?: string | null;
        toAddresses?: string[];
        setId?: string;
        delegationId?: string;
        reminder?: 1 | 2;
      }
    ): Promise<{ emailId: string; draftId: string; sendId: string }>;
    ```

  - Decisions:
    - **The `ClaimFilter` shape change (M2).** The S3 `ClaimFilter` is a plain union (`repo.ts:146`) with 4 users; change each in this step: `claimFilterFor` (`scope.ts:9`) returns the `mailbox` part; `scopeAdmits` (`scope.ts:16`; called from `undo.ts:45` as `scopeAdmits(claimFilterFor(…), …)`, which stays as it is) reads `filter.kind` of the `mailbox` part; `claimableWhere` (`repo.ts:185`; the filter branches at `:198-202`) reads `opts.filter.mailbox` for the S3 branch and `opts.filter.send` for the send branch; `warnWhenHeldBack` (`committer.ts:123-133`) passes `filter: { mailbox: { kind: "all" }, send: { kind: "none" } }`. The committer builds `filter = { mailbox: claimFilterFor(deps.scope, mailbox.address), send: { kind: "none" } }` at `committer.ts:208` until stage 12 passes `sendFilterFor(deps.sendScope, …)`. The S3 tests that pass a `ClaimFilter` (Files) wrap their old value as `{ mailbox: <old>, send: { kind: "none" } }`.
    - **The two S3 `payload.folder` readers (M4).** With `payload: Record<string, unknown>`, `apply.ts:263` (`const folderKey = action.payload.folder`) and `notices.ts:121` (`const key = action.payload.folder`) no longer compile: narrow first, `const folderKey = typeof action.payload.folder === "string" ? action.payload.folder : undefined` (the same in `notices.ts`); `isFolderKey` and `Object.hasOwn` stay. `UndoCandidate.payload` (`repo.ts:444`) does not change.
    - The claim `WHERE` (one query, `FOR UPDATE OF a SKIP LOCKED`, as S3 7.1a). The S3 lock rule `(a.locked_at IS NULL OR a.locked_at < $staleBefore)` and `(a.next_attempt_at IS NULL OR a.next_attempt_at <= $now)` apply to **every** branch. A row is selected when:
      - the S3 branch: `a.status = 'ready'` with the S3 rules for `MAILBOX_ACTION_TYPES` and `save_summary` (unchanged, with the S3 age rules); or
      - the draft branch: `a.type = 'create_draft'` and `<mailbox filter>` (`none` → never; `synthetic` → `mailKindFilter("synthetic")`; `all` → true) and ((`a.reverses_action_id IS NOT NULL` and `a.status = 'ready'`) or (`a.reverses_action_id IS NULL` and `a.status = 'ready'` and `EXISTS (SELECT 1 FROM actions s WHERE s.depends_on_action_id = a.id AND s.org_id = a.org_id AND s.status = 'awaiting_approval')` — a draft is made only while its send waits; a `ready` draft whose send ended is expired by `closeDraftOfSend` (stage 7.1) and never claimed) or (`a.reverses_action_id IS NULL` and `a.status = 'applying'`, whatever the state of its send — the recovery: an APPEND may have stored the message, so the apply step locates it and removes or expires it when the send is gone, D12, review round 2 N12)); or
      - the send branch: `a.type = 'send'` and `EXISTS (SELECT 1 FROM actions d WHERE d.id = a.depends_on_action_id AND d.org_id = a.org_id AND d.status = 'applied')` and ((`a.status = 'approved'` and `a.approved_at >= $now − APPROVAL_TTL_MS` and `<send filter>`) or `a.status = 'applying'` (the recovery: it sends nothing, so the send filter does not apply: D16)).
      - `<send filter>`: `none` → false; `all` → true; `self` → `jsonb_array_length(a.payload->'to') > 0 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(a.payload->'to') r WHERE lower(r) <> ALL($addresses::text[]))` (`payload.to` is a JSON array, D2).
      - An `approved` send locked by a run that died between the claim and `markApplying` is claimed again when its lock is stale (10 min): safe, because `markApplying` commits before any SMTP call, and it keeps the row from being stuck for ever (reviewer finding 5).
    - Order: `received_at`, `email id`, the type rank `save_summary` 0, `flag` 1, `mark_read` 2, `move` 3, `create_draft` 4, `send` 5; `locked_at = $now` for every claimed row (also an `approved` one: `locked_at` is the token until `markApplying`). `original_created_at` = the `created_at` of the reversed row (a join for reverse rows; null for originals): stage 11.2 needs it for the locate window.
    - **The 48 h limit after the tap is in the claim too** (review round 3, major): an `approved` send whose `approved_at` is older than `APPROVAL_TTL_MS` is never claimed (also not by `countClaimable`), so a send held past its limit cannot go out in the hour before the expiry job closes it as `held_timeout` (after `/resume`, a password fix, or the switch to `SEND_SCOPE=all`). The same gap for `awaiting_approval` is closed by `approve` (10.2). The recovery branch (`applying`) has no age rule: it sends nothing.
    - The draft branch's `applying` recovery stays behind `<mailbox filter>`: under `ACTIONS_SCOPE=off` nothing touches the mailbox, so an `applying` draft waits (also when its send expired meanwhile: `closeDraftOfSend` leaves it, D13) until the scope admits the mail again; then the recovery locates it and removes or expires it (D12, D16; review round 3 question, decided).
    - `countHeldSends`: `type = 'send'`, `status = 'approved'`, the mailbox, the draft `applied`, and `NOT (<send filter>)` (`none` → every such row); the committer prints it once per process per mailbox (stage 12.1, D16).
    - `countClaimable`: the same `WHERE` without the lock; `sending` = the count of `send` rows; `mailboxChanging` = `MAILBOX_ACTION_TYPES` plus `create_draft` (so the S3 line of `warnWhenHeldBack`, `committer: ACTIONS_SCOPE=off, <n> mailbox actions wait in mailbox <id>`, counts drafts too: M10, stage 21.2 updates the known alert). In the committer `countClaimable` stays only the `total === 0` early return (`committer.ts:210-211`); the committer decides which connections to open after the claim, from the batch (`committer.ts:217`, M9; stages 11.1 and 12.1 change it).
    - `markApplying` sets `status = 'applying'`, `outgoing_message_id` when given, `updated_at = now()`; it keeps `locked_at` (the claim token stays valid through the step). `finishAction` as S3 plus the `from` list; `applied` also clears `last_error`; `failed` stores `providerResult` when given. `releaseAction` sets `status = toStatus`, `locked_at = NULL`, `next_attempt_at`, `attempts + 1` when `countAttempt`, `last_error`; `WHERE status IN ('ready', 'approved', 'applying') AND locked_at = lockedAt`. The S3 `releaseActions` (batch, no count) clears `locked_at` of `approved` and `applying` rows too and never changes a status: a batch released before a row ran leaves it in its pre-claim status (`approved` or `ready`), because `markApplying` is the first thing the apply step does for that row.
    - `expireStaleReady` (S3 D21) is unchanged: its type filter keeps drafts and sends out (D17).
    - `insertDraftAndSend`: inserts a triaged mail (`insertTriaged` with the given `subject`, `from`, `messageId`; its options, `fixtures.ts:121-136`, have no body or thread fields), then sets `body_text`, `in_reply_to`, `references_header` and `to_addresses` (from `bodyText`, `inReplyTo`, `referencesHeader`, `toAddresses`; defaults null, null, null, `[]`) with one `updateTable("emails")`, as `insertTriagedWithActions` does for its location columns (M7); then the draft (`create_draft`, the payload of D2 built from the options including `delegation_id` when given, `idempotency_key` `${emailId}:create_draft` or `:reminder:<day>`, `provider_result` when given) and the send (`payload` from `sendPayloadFor` plus `delegation_id`, `set_id`, `depends_on_action_id`, `notified_at`, the approval fields when `approved`, `outgoing_message_id`, `locked_at`). Default statuses `applied` / `awaiting_approval`. Both rows go through `insertAction` with the options that stage 7.1 added (M6).
  - Test (`actions-repo.test.ts`, `withRollback`, the fixture; `filter.mailbox` `all` and `filter.send` `all` unless said otherwise): (1) a `ready` draft and an `awaiting_approval` send → the claim returns the draft only; (2) the draft `applied`, the send `approved` (`approved_at` set) → the send is claimed with `email.body_text`, `in_reply_to`, `references_header`, `to_addresses`; (3) the draft `ready` and the send `approved` → only the draft (the send waits for its draft); (3b) a `ready` draft whose send is `rejected` or `expired` → not claimed and not counted; an `applying` draft with `locked_at` null whose send is `rejected` → claimed (the recovery, N12); (4) `filter.send` `none` → the `approved` send is not claimed, `countClaimable.sending` 0 and `total` 0 for it; `self` with `["b@x.test"]` and `payload.to` `["B@x.test"]` → claimed; with `["c@x.test"]` → not; (4b) an `applying` send with `locked_at` null under `filter.send` `none` → claimed (the recovery ignores the send filter); (5) `filter.mailbox` `none` → the draft is not claimed; `synthetic` → a draft of a synthetic mail is, a real mail's is not; (6) an `applying` draft with `locked_at` null and `next_attempt_at` in the past → claimed; with `next_attempt_at` in the future → not; an `applying` send with `locked_at` 11 min ago → claimed (stale); with `locked_at` 1 min ago → not; an `approved` send with `locked_at` 11 min ago → claimed; with `locked_at` 1 min ago → not; (7) `markApplying` from `approved` with the right token → true, `status` `applying`, `outgoing_message_id` set; with a wrong token → false; from `applied` → false; (8) `finishAction(applied)` from `applying` → true; `finishAction(failed, reason smtp_rejected, providerResult { stage, response_code })` → `status_reason`, `last_error`, `provider_result`; (9) `releaseAction({ toStatus: "approved", countAttempt: true })` from `applying` → `approved`, `attempts` 1, `locked_at` null; `releaseActions` on an `approved` and an `applying` row → both unlocked, statuses unchanged; (10) `updateProviderResult` merges `{ sent_copy: "failed" }` into an existing object; (11) the order: for one mail a `ready` `move`, a `ready` draft and an `approved` send (draft applied) → `move`, `create_draft`, `send`; (12) a draft of a mail received 8 days ago created today is claimed (no age rule for drafts); a `move` of that mail is not (S3 M10); (13) tenant: org B's ctx claims nothing of org A; (14) two connections (own org, deleted at the end, the S3 D20 pattern): connection 1 claims the send in an open transaction; connection 2 gets nothing (`SKIP LOCKED`); (15) a reverse draft row carries `original_created_at`; (15b) an `approved` send with `approved_at` 49 h ago, `locked_at` null and `filter.send` `all` → not claimed and not counted; 47 h ago → claimed; an `applying` send with `approved_at` 49 h ago and `locked_at` null → claimed (recovery); (16) `countHeldSends` with `send` `none` → 1 for an `approved` send with an applied draft, 0 for one whose draft is `ready`; with `self` and the address in the list → 0. `scope.test.ts`: `sendFilterFor` for the three kinds, the address case and another mailbox; `sendScopeAdmits` rows.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass; the S3 committer, apply, move and undo tests still pass with the `mailbox` / `send` filter shape (the S3 call sites pass `{ mailbox: <old filter>, send: { kind: "none" } }`).
  - Out of scope: the apply branches (stages 11, 12).

- [x] **10.2 Approvals, send-again, the expiry and notice queries (D18, D20, D22)**
  - Goal: a send becomes `approved` only through `approve`; `reject`, the sets and "send again" are conditional, audited and tap-proof; the notifier and the expiry job have their queries.
  - Files: create `apps/server/src/modules/actions/approvals.ts`, `apps/server/test/integration/actions-approvals.test.ts`; change `actions/repo.ts` (also the S3 `listFailedUnnotified` filter, D33), `actions/index.ts`, `apps/server/src/modules/audit/repo.ts` (`auditEvents`: `actionApplying: "action.applying"`, `actionApproved: "action.approved"`, `actionRejected: "action.rejected"`, `actionSendAgain: "action.send_again"`, `actionSentCopyFailed: "action.sent_copy_failed"`), `apps/server/test/integration/actions-repo.test.ts`.
  - Interfaces:

    ```ts
    // repo.ts (stage 7.1 made SendRow, lockSend, getSend, lockDraft, getDraft, listSendsOfDraft, setExpired; actions/expiry.ts has expireSend and closeDraftOfSend)
    export async function setApproved(trx, ctx, id, input: { userId: string; via: string; at: Date }): Promise<boolean>; // WHERE status = 'awaiting_approval'
    export async function setRejected(trx, ctx, id, opts: { at: Date; staleBefore: Date }): Promise<boolean>; // WHERE status = 'awaiting_approval' OR (status = 'approved' AND (locked_at IS NULL OR locked_at < staleBefore)); status_reason 'rejected'
    export async function listSetSends(trx, ctx, setId: string): Promise<SendRow[]>; // FOR UPDATE; payload->>'set_id' = setId
    export async function insertSendAgain(
      trx,
      ctx,
      previous: SendRow,
      input: { userId: string; via: string; at: Date }
    ): Promise<string | null>; // status approved, same payload and depends_on, idempotency `${previous.id}:again`, ON CONFLICT DO NOTHING → null
    export async function listSendsToNotify(db, ctx, opts: { limit: number }): Promise<SendRow[]>; // awaiting_approval, notified_at null, no set_id, draft applied, mailbox active
    export async function listSetsToNotify(db, ctx, opts: { limit: number }): Promise<Map<string, SendRow[]>>; // the same with set_id, grouped; a set is listed when none of its sends has a draft in ('ready', 'applying')
    export async function listSendResultsToNotify(
      db,
      ctx,
      opts: { limit: number; now: Date; pendingCopyMaxAgeMs: number }
    ): Promise<SendRow[]>; // type send, result_notified_at null, status in ('failed', 'expired', 'rejected'), or 'applied' with provider_result->>'sent_copy' <> 'pending' or applied_at < now − pendingCopyMaxAgeMs; oldest updated_at first
    export async function markResultNotified(db, ctx, id, at): Promise<boolean>; // WHERE result_notified_at IS NULL
    export async function listExpiredApprovals(
      db,
      ctx,
      mailboxId,
      opts: { now: Date; limit: number; staleBefore: Date }
    ): Promise<{ id: string; reason: "timeout" | "draft_missing" | "not_notified" | "held_timeout" }[]>;
    export async function countApprovals(
      db,
      ctx,
      opts: { staleBefore: Date }
    ): Promise<{ waiting: number; oldestNotifiedAt: Date | null; approvedHeld: number }>; // waiting = awaiting_approval sends; approvedHeld = approved sends with locked_at null or < staleBefore
    // listFailedUnnotified (S3 7.1b): + `type <> 'send' AND (type <> 'create_draft' OR reverses_action_id IS NOT NULL)` (one notice per failure, D20)
    // approvals.ts
    export const APPROVAL_TTL_MS = 48 * 3_600_000; // shared with stage 13 through the actions index
    export type ApproveResult =
      | { kind: "approved" }
      | { kind: "already_approved"; at: Date; byUserId: string | null }
      | { kind: "sent" }
      | { kind: "sending" }
      | { kind: "rejected" }
      | { kind: "expired" }
      | { kind: "failed"; reason: string | null }
      | { kind: "draft_not_ready" } // checkpoint 2: the draft of the send is not `applied`; no change, no audit
      | { kind: "not_found" };
    export interface ApprovalDeps {
      db;
      hooks: DelegationHooks;
      uidplus(ctx, mailboxId: string): Promise<boolean>;
    }
    export async function approve(
      deps: ApprovalDeps,
      ctx,
      actionId,
      input: { userId: string; via: "telegram" | "cli"; now: Date }
    ): Promise<ApproveResult>;
    export type RejectResult = { kind: "rejected" } | { kind: "already"; status: string } | { kind: "not_found" };
    export async function reject(
      deps: ApprovalDeps,
      ctx,
      actionId,
      input: { userId: string; via; now: Date }
    ): Promise<RejectResult>;
    export async function approveSet(deps, ctx, setId, input): Promise<{ approved: number; skipped: number }>;
    export async function rejectSet(deps, ctx, setId, input): Promise<{ rejected: number; skipped: number }>;
    export type SendAgainResult =
      | { kind: "created"; actionId: string }
      | { kind: "already" }
      | { kind: "draft_gone" }
      | { kind: "not_failed" }
      | { kind: "not_found" };
    export async function sendAgain(
      db,
      ctx,
      failedActionId,
      input: { userId: string; via; now: Date }
    ): Promise<SendAgainResult>;
    ```

  - Decisions:
    - `approve`: one transaction; `lockSend` undefined → `not_found` (the same answer for another organization's id); by status: `awaiting_approval` with `notified_at !== null && notified_at + APPROVAL_TTL_MS < now` → the row is expired on the spot with the D22 steps (`expireSend(trx, ctx, id, { reason: "timeout", now, actor: userId, hooks, uidplus })`, stage 7.1: the draft reverse or the pending-draft expiry, `hooks.onCancelled`) → `expired` (the hourly job is late by up to an hour: a tap in that window must not send); `awaiting_approval` → `setApproved` + audit `action.approved` (`actor` = userId, `data: { via }`) → `approved`; `approved` → `already_approved` (`at`, `byUserId`) when `locked_at` is null or stale, else `sending`; `applying` → `sending`; `applied` → `sent`; `rejected` → `rejected`; `expired` → `expired`; `failed` → `failed` with `status_reason`. No owner check here: the Telegram handler checks `link.role` (D26); the CLI is the owner.
    - `reject`: lock; `setRejected({ at, staleBefore: now − 10 min })` true → audit `action.rejected` (`actor`); `closeDraftOfSend(trx, ctx, depends_on_action_id, { reason: "rejected", now, uidplus: await deps.uidplus(ctx, mailboxId) })` (stage 7.1: an `applied` draft gets the reverse row with UIDPLUS, a `ready` draft is expired, an `applying` draft is handled by its own apply step); `payload.delegation_id` without `reminder` → `hooks.onCancelled(trx, ctx, { delegationId, reason: "rejected", at })`; `result_notified_at` stays null (the notifier picks the new state, D20) → `rejected`; false → `already` with the current status. `uidplus(ctx, mailboxId)` reads `mailboxes.capabilities` through the `mail` index (`getMailbox`), given as a dependency so tests can set it.
    - `approveSet` / `rejectSet`: lock the set's rows; apply the `approve` / `reject` steps to each `awaiting_approval` row **with `notified_at` not null** (only the items the set message showed: a row whose draft failed was left out of the message, D21, review round 3; it expires as `draft_missing`); one audit row each; the TTL check per row; `skipped` = rows in another status or not notified.
    - `sendAgain`: lock; the row must be `send` with status `failed` and `status_reason` in (`outcome_unknown`, `smtp_error`) → else `not_failed`; the draft must be `applied` → else `draft_gone`; `insertSendAgain` (status `approved`, `approved_by/at/via`, `payload` copied — it carries `delegation_id` when the first send had it — `outgoing_message_id` null until `markApplying`, idempotency `${failedActionId}:again`) → null (the key exists: a second tap, a double tap or another owner's tap) → `already`; else audit `action.send_again` on the new row (`data: { previous_action_id }`) → `created`. One resend per failed row: a failure of the new row has its own id and its own `:again` key (reviewer finding 1). The delegation stays `cancelled` until the new send is `applied` (D6: `markDelegationSent` accepts `cancelled`).
    - `listExpiredApprovals` returns per mailbox: `timeout` = `awaiting_approval` with `notified_at < now − 48 h`; `draft_missing` = `awaiting_approval` whose draft is `failed` or `undone`; `not_notified` = `awaiting_approval`, `notified_at` null, `created_at < now − 7 days`; `held_timeout` = `approved` with `approved_at < now − 48 h` and (`locked_at` null or `< staleBefore`) — a send that the scope, a paused mailbox or a retry wait held for 48 h after the tap never goes out later without a new tap (D22, review round 2 N1); a row matches the first reason that applies in that order.
    - `listSendsToNotify` and `listSetsToNotify` join the draft (`applied`) and the mailbox (`status = 'active'`); the delegation row is not needed (the text comes from the payload and the email).
    - All functions take `TenantContext`; the queries filter `org_id` on every table.
  - Test (`actions-approvals.test.ts`, `withRollback`, fixtures; `hooks` = a recording fake; `uidplus` → true unless said otherwise): (1) `approve` on `awaiting_approval` → `approved`, the row has `approved_by/at/via`, audit; again → `already_approved` with the first user; (1b) `awaiting_approval` with `notified_at` 49 h ago → `expired`, the row `expired` / `timeout`, a reverse draft row, `hooks.onCancelled` with `expired`, no `approved_by`; (2) on `applied` → `sent`; on `applying` → `sending`; on `approved` with `locked_at` 1 min ago → `sending`; with `locked_at` 11 min ago → `already_approved`; on `rejected` → `rejected`; on `failed` → `failed` with the reason; a random uuid and org B's id → `not_found`; (3) `reject` on `awaiting_approval` with an applied draft → `rejected`, a reverse `create_draft` row `ready` with `reverses_action_id` and the payload, `hooks.onCancelled` called with `rejected` for a delegation send, not for a clarification send, not for a reminder send; with `uidplus` false → no reverse row; with a `ready` draft → the draft `expired` / `send_closed` and no reverse row; on an `approved` row with `locked_at` null → `rejected`; with `locked_at` 1 min ago → `already` `approved`; with `locked_at` 11 min ago → `rejected`; (4) `approveSet` with two `awaiting_approval` and one `rejected` row → `{ approved: 2, skipped: 1 }`; `rejectSet` likewise; a set row with `notified_at` null (its draft `failed`) → skipped by both, still `awaiting_approval`; (5) `sendAgain` on `failed` / `outcome_unknown` with an applied draft → `created`, the new row `approved` with the approval fields, `idempotency_key` `<failedId>:again`, `depends_on_action_id` = the draft, the payload with `delegation_id`; again (and by another user) → `already`, still one new row; on `failed` / `smtp_rejected` → `not_failed`; with the draft `undone` → `draft_gone`; (6) `listSendsToNotify`: a send with an applied draft and an active mailbox is listed; with a `ready` draft or a paused mailbox not; a set send not; (7) `listSetsToNotify` groups two sends of one set; a set with one draft `ready` is not listed; (8) `listSendResultsToNotify` lists `failed`, `expired`, `rejected` sends with `result_notified_at` null, an `applied` send with `sent_copy` `appended`, and an `applied` send with `sent_copy` `pending` only when `applied_at` is older than `pendingCopyMaxAgeMs`; `markResultNotified` twice → true, false; (9) `listExpiredApprovals`: `notified_at` 49 h ago → `timeout`; a draft `failed` → `draft_missing` (`timeout` wins when both apply); `notified_at` null and `created_at` 8 days ago → `not_notified`; an `approved` row with `approved_at` 49 h ago and `locked_at` null → `held_timeout`; with `approved_at` 47 h ago → not listed; with `approved_at` 49 h ago and `locked_at` 1 min ago → not listed (in flight); (10) `countApprovals`: an `approved` row locked 11 min ago counts as held, one locked 1 min ago does not; (11) `listFailedUnnotified` (S3) leaves out a `failed` send and a `failed` original draft, lists a `failed` reverse draft and a `failed` move; (12) tenant: every function with org B's ctx sees nothing of org A.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass (user checkpoint 2 after the stage commit; group review of stages 2–10).
  - Out of scope: the Telegram handler (stage 16), the expiry job (stage 13), the notifier (stage 15).
