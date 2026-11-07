# s4-drafts-approvals-delegation — Stage 7

Part of [`../s4-drafts-approvals-delegation.md`](../s4-drafts-approvals-delegation.md). Read that file's "Input" and "Rules for every step" first.

## Stage 7 — Delegation module: repositories, service, CLIs `delegates:*` and `delegations:*` [risky]

Why risky: a delegate row is a recipient of real mail; tenant filters and the "never a mailbox address" rule live here.

- [x] **7.1 Repositories, the service, the hooks interface, the send-close functions (D6, D7, D13, D22, D28, D29)**
  - Goal: typed, tenant-filtered queries and audited state changes for delegates and delegations; the reply detection query; the `DelegationHooks` interface the committer, the approvals and the expiry job call; one shared way to close a send (`expireSend`) and its draft (`closeDraftOfSend`), created here because `expireReminderActions` is its first caller (stages 10, 11, 13 only call it: review round 2, N2); closing a delegation closes its pending reminders and removes their drafts.
  - Files: create `apps/server/src/modules/delegation/repo.ts`, `service.ts`, `index.ts`, `apps/server/src/modules/actions/hooks.ts` (the interface and `noDelegationHooks`; the `actions` module owns it, D29), `apps/server/src/modules/actions/expiry.ts` (`expireSend`, `closeDraftOfSend`; stage 13 adds the job to this file; it sits beside the S3 `actions/expire.ts`, which keeps `expireReady`), `apps/server/src/modules/actions/constants.ts` (`STALE_AFTER_MS`, moved from `committer.ts:26`: S3 feature 6), `apps/server/test/integration/delegation-repo.test.ts`, `delegation-service.test.ts`, `apps/server/test/integration/actions-close.test.ts`; change `apps/server/src/modules/actions/repo.ts` and `actions/index.ts` (`SendRow`, `lockSend`, `getSend`, `lockDraft`, `getDraft`, `listSendsOfDraft`, `listOpenReminderSends`, `setExpired`, the `insertReverse` payload type; the index also exports `expireSend`, `closeDraftOfSend`, `expireReminderActions` from `expiry.ts`: D33), `apps/server/src/modules/actions/committer.ts` and `actions/expire.ts` (import `STALE_AFTER_MS` from `./constants`; `expire.ts:7` imports it from `./committer` today), `apps/server/src/modules/mail/repo.ts` and `mail/index.ts` (`getEmailMeta`, `mailboxHasUidplus`; `mail/index.ts` also exports `normalizeMessageId` from `./sync-rules` (`sync-rules.ts:9`; today only `mail/tools.ts` and the sync import it inside the module: M19)), `apps/server/src/modules/audit/repo.ts` (`auditEvents`: `delegateAdded: "delegate.added"`, `delegateChanged: "delegate.changed"`, `delegationCreated: "delegation.created"`, `delegationSent: "delegation.sent"`, `delegationAnswered: "delegation.answered"`, `delegationOverdue: "delegation.overdue"`, `delegationCancelled: "delegation.cancelled"`, `delegationDone: "delegation.done"`, `delegationChaserRun: "delegation.chaser_run"`), `apps/server/test/integration/fixtures.ts` (`insertDelegate`, `insertDelegation`; the wider `insertAction` and `insertTriagedWithActions` options below: M6).
  - Interfaces:

    ```ts
    // actions/constants.ts (S3 feature 6: no import cycle committer → apply → drafts → expiry → committer)
    export const STALE_AFTER_MS = 10 * 60_000; // the S3 value, moved; `actions/index.ts:45` re-exports it from here
    // fixtures.ts (M6): insertAction (S3, `fixtures.ts:171-185`) options become
    //   { type; status; payload?: Record<string, unknown>; idempotencyKey?; appliedAt?; reversesActionId?; attempts?; nextAttemptAt?;
    //     lockedAt?; statusReason?; createdAt?;
    //     dependsOnActionId?: string | null; providerResult?: Record<string, unknown> | null;
    //     approvedAt?: Date | null; approvedBy?: string | null; approvedVia?: string | null;
    //     notifiedAt?: Date | null; outgoingMessageId?: string | null }
    // insertTriagedWithActions (S3, `fixtures.ts:224-241`): each `actions` entry takes the same options (except `createdAt`, which it sets)
    // actions/hooks.ts
    export interface DelegationHooks {
      onSent(
        trx,
        ctx,
        input: { delegationId: string; sentMessageId: string; sentAt: Date; dueAtWhenNull: Date }
      ): Promise<boolean>;
      onReminderSent(trx, ctx, input: { delegationId: string; at: Date }): Promise<boolean>;
      isOpen(trx, ctx, delegationId: string, kind: "reminder" | "delegation"): Promise<boolean>; // checkpoint 2: for sendAgain, D18
      onCancelled(trx, ctx, input: { delegationId: string; reason: string; at: Date }): Promise<boolean>;
    }
    export const noDelegationHooks: DelegationHooks; // every call returns false (tests, composition roots that need none)
    // actions/repo.ts
    export interface SendRow {
      id;
      email_id;
      status;
      status_reason;
      payload: Record<string, unknown>;
      depends_on_action_id;
      notified_at;
      approved_by;
      approved_at;
      approved_via;
      outgoing_message_id;
      provider_result;
      applied_at;
      created_at;
      updated_at;
      attempts;
      last_error;
      locked_at;
      email: {
        mailbox_id;
        subject;
        from_address;
        message_id_header;
        received_at;
        references_header;
        in_reply_to;
        body_text;
      };
    }
    export async function lockSend(trx, ctx, id): Promise<SendRow | undefined>; // FOR UPDATE OF the action row, type = 'send'
    export async function getSend(db, ctx, id): Promise<SendRow | undefined>;
    export interface DraftRow {
      id;
      email_id;
      status;
      payload: Record<string, unknown>;
      provider_result: Record<string, unknown> | null;
      created_at;
      locked_at;
    }
    export async function lockDraft(trx, ctx, id): Promise<DraftRow | undefined>; // FOR UPDATE, type = 'create_draft', reverses_action_id IS NULL
    export async function getDraft(db, ctx, id): Promise<DraftRow | undefined>;
    export async function listSendsOfDraft(db, ctx, draftId): Promise<{ id: string; status: string }[]>; // send rows with depends_on_action_id = draftId (a resend shares the draft, D18)
    export async function setExpired(
      trx,
      ctx,
      id,
      opts: { reason: string; at: Date; from: "awaiting_approval" | "approved"; staleBefore: Date }
    ): Promise<boolean>; // WHERE status = from (and for `approved`: locked_at IS NULL OR locked_at < staleBefore); status_reason = reason; result_notified_at stays null
    export async function listOpenReminderSends(trx, ctx, delegationId: string): Promise<string[]>; // ids; type send, payload delegation_id = id, a `reminder` key, status awaiting_approval or approved; FOR UPDATE
    // insertReverse (S3, `repo.ts:491`): `payload` widens from Record<string, string> to Record<string, string | number | null> (the draft reverse payload has a numeric `uid`, or null); change it in this step
    // actions/expiry.ts (service logic; imports repo.ts, never the other way)
    export async function expireReminderActions(
      trx,
      ctx,
      delegationId: string,
      opts: { now: Date; uidplus: boolean; actor: string }
    ): Promise<{ sends: number }>; // listOpenReminderSends → expireSend(reason "delegation_closed") for each
    export type SendCloseReason =
      | "timeout"
      | "draft_missing"
      | "not_notified"
      | "held_timeout"
      | "policy_changed"
      | "delegation_closed";
    export async function expireSend(
      trx,
      ctx,
      sendId: string,
      opts: { reason: SendCloseReason; now: Date; actor: string; hooks: DelegationHooks; uidplus: boolean }
    ): Promise<boolean>; // false = the row was not in a closable state (a tap, a send or another close won)
    export async function closeDraftOfSend(
      trx,
      ctx,
      draftId: string,
      opts: { reason: "sent" | "rejected" | "expired"; now: Date; uidplus: boolean }
    ): Promise<"reverse" | "expired" | "none">;
    // mail/repo.ts and mail/index.ts
    export async function mailboxHasUidplus(db, ctx, mailboxId): Promise<boolean>; // getMailbox(…)?.capabilities.uidplus === true
    // mail/repo.ts
    export async function getEmailMeta(
      db,
      ctx,
      emailId
    ): Promise<
      | { id; mailbox_id; subject; from_address; message_id_header; in_reply_to; references_header; received_at }
      | undefined
    >;
    // delegation/repo.ts
    export interface DelegateRow {
      id: string;
      name: string;
      email: string;
      competence_tags: string[];
      active: boolean;
      created_at: Date;
      updated_at: Date;
    }
    export async function insertDelegate(
      db,
      ctx,
      input: { name: string; email: string; tags: string[] }
    ): Promise<string | null>; // null = the email exists in this org
    export async function listDelegates(db, ctx, opts?: { activeOnly?: boolean }): Promise<DelegateRow[]>; // name, id order
    export async function getDelegate(db, ctx, id: string): Promise<DelegateRow | undefined>;
    export async function listDelegateNames(db, ctx, ids: readonly string[]): Promise<Map<string, string>>;
    export async function listDelegateAddresses(db, ctx, opts?: { activeOnly?: boolean }): Promise<string[]>; // for isExternalSender (D8)
    export async function setDelegateActive(db, ctx, id: string, active: boolean, at: Date): Promise<boolean>;
    export type DelegationStatus = "drafted" | "sent" | "answered" | "overdue" | "done" | "cancelled";
    export interface DelegationRow {
      id;
      mailbox_id;
      email_id;
      delegate_id;
      draft_action_id;
      send_action_id;
      task_summary;
      due_at: Date | null;
      status: DelegationStatus;
      status_reason: string | null;
      sent_message_id: string | null;
      sent_at: Date | null;
      last_reminder_at: Date | null;
      reminders_sent: number;
      answered_email_id: string | null;
      answered_at: Date | null;
      answered_notified_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }
    export async function insertDelegation(
      trx,
      ctx,
      input: {
        mailboxId;
        emailId;
        delegateId;
        draftActionId;
        sendActionId;
        taskSummary: string;
        dueAt: Date | null;
        createdAt: Date;
      }
    ): Promise<string>;
    export async function getDelegation(db, ctx, id): Promise<DelegationRow | undefined>;
    export async function lockDelegation(trx, ctx, id): Promise<DelegationRow | undefined>; // FOR UPDATE
    export async function findDelegationBySendAction(db, ctx, sendActionId): Promise<DelegationRow | undefined>;
    export async function findOpenDelegationByMessageIds(
      db,
      ctx,
      mailboxId,
      ids: readonly string[],
      fromAddress: string
    ): Promise<{ id: string; delegateId: string } | undefined>;
    export async function markDelegationSent(
      trx,
      ctx,
      id,
      next: { sentMessageId: string; sentAt: Date; dueAtWhenNull: Date }
    ): Promise<boolean>; // WHERE status IN ('drafted', 'cancelled'); due_at = COALESCE(due_at, dueAtWhenNull); status_reason NULL
    export async function markDelegationAnswered(
      trx,
      ctx,
      id,
      next: { answeredEmailId: string; at: Date }
    ): Promise<boolean>; // WHERE status IN ('sent', 'overdue')
    export async function markDelegationOverdue(trx, ctx, id, at: Date): Promise<boolean>; // WHERE status = 'sent'
    export async function markDelegationCancelled(trx, ctx, id, next: { reason: string; at: Date }): Promise<boolean>; // WHERE status = 'drafted'
    export async function markDelegationDone(trx, ctx, id, at: Date): Promise<boolean>; // WHERE status IN ('answered', 'overdue')
    export async function markReminderPlanned(trx, ctx, id, at: Date): Promise<boolean>; // last_reminder_at = at; WHERE status IN ('sent', 'overdue')
    export async function bumpReminder(trx, ctx, id, at: Date): Promise<boolean>; // reminders_sent + 1; WHERE status IN ('sent', 'overdue')
    export async function listDueDelegations(
      db,
      ctx,
      mailboxId,
      opts: { now: Date; limit: number }
    ): Promise<(DelegationRow & { delegate_active: boolean; delegate_email: string; delegate_name: string })[]>; // status IN ('sent', 'overdue') AND due_at < now; oldest due first
    export async function countPendingReminderSends(db, ctx, delegationId): Promise<number>; // send rows with payload->>'delegation_id' = id, a `reminder` key, status IN ('awaiting_approval', 'approved', 'applying')
    export async function countOpenDelegations(db, ctx): Promise<{ open: number; overdue: number }>; // open = sent, overdue = overdue
    export async function listDelegations(
      db,
      ctx,
      opts: { status?: DelegationStatus; limit: number }
    ): Promise<(DelegationRow & { delegate_name: string; subject: string | null })[]>;
    export async function listAnsweredUnnotified(
      db,
      ctx,
      opts: { limit: number }
    ): Promise<(DelegationRow & { delegate_name: string; subject: string | null })[]>;
    export async function markAnsweredNotified(db, ctx, id, at: Date): Promise<boolean>; // WHERE answered_notified_at IS NULL
    // delegation/service.ts
    export type AddDelegateResult =
      | { kind: "added"; id: string }
      | { kind: "exists" }
      | { kind: "mailbox_address" }
      | { kind: "invalid"; field: "name" | "email" | "tags" };
    export async function addDelegate(
      db,
      ctx,
      input: { name: string; email: string; tags: string[]; actor: string; now: Date }
    ): Promise<AddDelegateResult>;
    export async function setDelegateState(
      db,
      ctx,
      input: { id: string; active: boolean; actor: string; now: Date }
    ): Promise<"changed" | "same" | "not_found">;
    export async function createDelegation(
      trx,
      ctx,
      input: {
        mailboxId;
        emailId;
        delegateId;
        draftActionId;
        sendActionId;
        task: string;
        dueDate: string | null;
        timezone: string;
        now: Date;
      }
    ): Promise<string>;
    export async function detectReply(
      db,
      ctx,
      mailboxId,
      mail: { fromAddress: string | null; inReplyTo: string | null; referencesHeader: string | null }
    ): Promise<{ delegationId: string; delegateId: string } | null>;
    export async function markAnswered(trx, ctx, delegationId, input: { emailId: string; at: Date }): Promise<boolean>;
    export async function cancelDelegation(
      trx,
      ctx,
      delegationId,
      input: { reason: string; at: Date }
    ): Promise<boolean>;
    export async function closeDelegation(
      trx,
      ctx,
      delegationId,
      input: { actor: string; at: Date }
    ): Promise<CloseResult>;
    // { kind: "done" } | { kind: "already" } (status done) | { kind: "not_closable"; status } (drafted, sent, cancelled) | { kind: "not_found" }
    export function delegationHooks(deps: { db }): DelegationHooks; // binds onSent, onReminderSent, onCancelled to the service functions
    ```

  - Decisions:
    - `addDelegate`: `name` trimmed 1–100 characters, `email` trimmed, lower-cased, must match `ADDRESS_PATTERN` (`packages/core`, stage 3), `tags` ≤ 10 entries of 1–30 characters each (trimmed, lower-cased, duplicates removed); the email must not equal any `mailboxes.address` of the organization (`listMailboxes`, case-insensitive) → `mailbox_address`; `insertDelegate` null → `exists`; success → audit `delegate.added` (`data: { delegate_id }`, `actor`). `setDelegateState` → audit `delegate.changed` (`data: { delegate_id, active }`).
    - `createDelegation`: `due_at` = `localToInstant(dueDate, "17:00", timezone)` when `dueDate` is a valid calendar date (an impossible date such as `2026-02-30` → null), else null; audit `delegation.created` (`data: { delegation_id, delegate_id, send_action_id, due: boolean }`, `emailId`, `actionId` = the send). It runs in the caller's transaction (`saveTriage`, stage 9); the caller then merges `delegation_id` into the two action payloads (D2).
    - `findOpenDelegationByMessageIds`: `ids` normalized with `normalizeMessageId` by the caller (`detectReply`; it imports the function from the `mail` index, exported in this step: M19); one query: delegations of the mailbox with `status IN ('sent', 'overdue')`, joined to `delegates` with `lower(delegates.email) = lower($fromAddress)` **inside the query** (another delegation in the same thread to another delegate never hides the right one), and (`sent_message_id = ANY(ids)` OR `EXISTS (SELECT 1 FROM actions a WHERE a.org_id = d.org_id AND a.type = 'send' AND a.status = 'applied' AND a.payload->>'delegation_id' = d.id::text AND a.outgoing_message_id = ANY(ids))`); the oldest `created_at` first, limit 1. The `delegation` repo reads `actions` rows in this join and in `countPendingReminderSends`; it never writes them (the `actions` module does, through `expireReminderActions` and `expireSend` below). `detectReply`: `ids` = `[inReplyTo, ...referencesHeader.split(/\s+/)]` without nulls and empties; `[]` or a null `fromAddress` → null.
    - `markAnswered` = `markDelegationAnswered` + `expireReminderActions(trx, ctx, id, { now, uidplus: await mailboxHasUidplus(trx, ctx, delegation.mailbox_id), actor })` + audit `delegation.answered` (`data: { delegation_id, delegate_id, reminders_expired }`, `emailId` = the answer). `cancelDelegation` = `markDelegationCancelled` + `expireReminderActions` + audit `delegation.cancelled` (`reasonCode` = the reason). `closeDelegation` = `markDelegationDone` + `expireReminderActions` + audit `delegation.done` (`actor`); `getDelegation` undefined → `not_found`; false → `already`. In all three, `delegation` = the row read in the same transaction (`lockDelegation`), the `uidplus` value comes from `mailboxHasUidplus(trx, ctx, delegation.mailbox_id)`, and `actor` is `system` (`markAnswered`, `cancelDelegation`) or the caller's actor (`closeDelegation`). So a reminder never goes to a delegate whose delegation is answered, done or cancelled (reviewer finding 7), and its draft is removed (N3).
    - `delegationHooks`: `onSent(trx, ctx, { delegationId, sentMessageId, sentAt, dueAtWhenNull })` = `markDelegationSent` + audit `delegation.sent`; `onReminderSent(trx, ctx, { delegationId, at })` = `bumpReminder`; `onCancelled(trx, ctx, { delegationId, reason, at })` = `cancelDelegation`. They run inside the committer's, the approvals' and the expiry job's transactions.
    - **`expireSend(trx, ctx, sendId, opts)`** (`actions/expiry.ts`; the D22 cascade for one send; every caller holds the transaction): (1) `send = lockSend(trx, ctx, sendId)`; undefined → false. (2) The closable states: `awaiting_approval` (every reason); `approved` only for `held_timeout` and `delegation_closed`, and only when `locked_at` is null or older than `STALE_AFTER_MS` (the S3 10-minute stale rule: a send in flight finishes); every other state → false. (3) `setExpired(trx, ctx, id, { reason, at: now, from: send.status, staleBefore: now − STALE_AFTER_MS })` false → false. (4) Audit `action.expired` (`actor`, `reasonCode` = the reason, `actionId`, `emailId`, `data: { action_type: "send", reason }`). (5) `closeDraftOfSend(trx, ctx, send.depends_on_action_id, { reason: "expired", now, uidplus })`. (6) `payload.delegation_id` set, no `payload.reminder`, and the reason is not `delegation_closed` → `hooks.onCancelled(trx, ctx, { delegationId, reason: reason === "draft_missing" ? "draft_missing" : "expired", at: now })` (D6: the delegation's reason list). (7) `result_notified_at` stays null, so the notifier sends the result (D20) → true.
    - **`closeDraftOfSend(trx, ctx, draftId, opts)`**: `draft = lockDraft(trx, ctx, draftId)`; by status: `ready` → `expired` / `send_closed` (conditional `WHERE status = 'ready'`) + audit `action.expired` → `"expired"`; `applied` and `uidplus` → `insertReverse` (S3 7.1b; `idempotency_key` `${draftId}:undo`, `ON CONFLICT DO NOTHING`; payload `{ kind: draft.payload.kind, folder: provider_result.folder, uid: provider_result.uid, reason }`) → `"reverse"`; `applied` without UIDPLUS → `"none"` (the draft stays; the result notice says so); `applying` → `"none"` (the draft's own apply step checks its send at the end and removes the draft then: D12, stage 11.1); `failed`, `expired`, `undone` → `"none"`. A `ready` draft never lands for a dead send, and an `applied` one never stays behind when the server has UIDPLUS (review round 2, N3 and N12).
    - **`expireReminderActions(trx, ctx, delegationId, { now, uidplus, actor })`**: (in `actions/expiry.ts`) the reminder sends of the delegation (`listOpenReminderSends`: `type = 'send'`, `payload->>'delegation_id' = id`, `payload ? 'reminder'`, status in `awaiting_approval`, `approved`; `FOR UPDATE`) → `expireSend(trx, ctx, id, { reason: "delegation_closed", now, actor, hooks: noDelegationHooks, uidplus })` for each; `sends` = the count of `true` results. So a held or retry-waiting `approved` reminder never goes to a delegate who answered, and its applied draft gets a removal row (review round 2, N3). An `applying` reminder (in flight now) finishes: the window is the SMTP round trip. The expired reminder send gets its `send_result` notice through D20 (the `delegation_closed` text, stage 14).
    - Every function takes a `TenantContext` and filters by `org_id` (the joins to `delegates`, `actions`, `emails` repeat the org filter).
    - **`STALE_AFTER_MS` (S3 feature 6):** `actions/expire.ts` imports it from `committer.ts` today (`expire.ts:7`). `drafts.ts` and `send.ts` (stages 11, 12) import `expiry.ts`, and `committer.ts` imports `apply.ts`, which imports `drafts.ts` and `send.ts`; so `expiry.ts` must never import `committer.ts`. Move the constant (value `10 * 60_000`, unchanged) to `actions/constants.ts`; `committer.ts`, `expire.ts` and `expiry.ts` import it from `./constants`; `actions/index.ts` re-exports it from `./constants` (the export name stays, so the callers outside the module do not change). The triage job's own `STALE_AFTER_MS` (`triage/jobs.ts:17`, 5 min) is another constant: do not touch it.
    - **Lock order (S3 `9f9f166`; S3 feature 4):** every S3 path locks the original action row before `emails`; `closeDraftOfSend` and `expireSend` write no `emails` row. S4 adds two orders: the committer locks a send (its `finishAction`), then the delegation (`onSent` → `markDelegationSent`, `onReminderSent` → `bumpReminder`); `markAnswered`, `closeDelegation`, `cancelDelegation` and the chaser (stage 17) lock the delegation (`lockDelegation`), then its reminder sends (`listOpenReminderSends`, `FOR UPDATE`). The two orders are opposite. They cannot deadlock only because a reminder in flight is `applying`, and `listOpenReminderSends` selects only `awaiting_approval` and `approved` rows, so it never waits for the committer's row. Keep that status filter, and write it as a comment next to the query.
    - **Fixtures (M6):** today `insertAction` and the `actions` entries of `insertTriagedWithActions` take only `payload?: Record<string, string>` and none of the S4 columns; an `approved` send without `approved_at` fails `actions_send_approved_check` (stage 2). Widen them to the options in the Interfaces block (`payload` is written with `JSON.stringify`, as today; each new option maps to its column, default null). Tests 11–17 build their draft and send rows with them (the draft-and-send fixture `insertDraftAndSend` comes in stage 10.1 and builds on `insertAction`).
  - Test (`delegation-repo.test.ts`, `withRollback`, fixtures): (1) `insertDelegate` returns an id; the same email again → null; another org → an id; (2) `listDelegates({ activeOnly: true })` leaves out an inactive one; `listDelegateNames` maps ids; `listDelegateAddresses`; (3) `insertDelegation` + `getDelegation` round trip; `lockDelegation`; `findDelegationBySendAction`; (4) state changes: `markDelegationSent` from `drafted` → true and `due_at` = `dueAtWhenNull` when null, kept when set; from `sent` → false; from `cancelled` → true (send again); `markDelegationAnswered` from `sent` and `overdue` → true, from `done` → false; `markDelegationOverdue` only from `sent`; `markDelegationCancelled` only from `drafted`; `markDelegationDone` from `answered` and `overdue`; `markReminderPlanned` sets `last_reminder_at`; `bumpReminder` increments; (5) `findOpenDelegationByMessageIds`: a `sent` delegation with `sent_message_id` `<m1>` and the delegate's address → found by `["<m1>"]`; with another `fromAddress` → undefined; two delegations in one thread to two delegates, the reply from the second delegate → the second one; a reminder send row (`applied`, payload `delegation_id`, `outgoing_message_id` `<r1>`) → found by `["<x>", "<r1>"]`; a `done` delegation → not found; another mailbox → not found; (6) `listDueDelegations` returns `sent` and `overdue` rows with `due_at < now` and the delegate's `active`, `email`, `name`; (7) `countPendingReminderSends` counts `awaiting_approval` and `approved`, not `applied` or `rejected`; (8) `countOpenDelegations`; (9) `listAnsweredUnnotified` + `markAnsweredNotified` twice → true, false; (10) tenant: each function with org B's ctx sees nothing of org A (one assertion per function). `actions-close.test.ts` (`withRollback`, fixtures `insertTriagedWithActions` with hand-made draft and send rows; `hooks` = a recording fake): (11) `expireSend` on an `awaiting_approval` delegation send with an `applied` draft (`provider_result { uid: 7, folder: "Drafts" }`), `uidplus` true, reason `timeout` → true, the send `expired` / `timeout`, audit `action.expired`, a reverse `create_draft` row `ready` with payload `{ kind, folder: "Drafts", uid: 7, reason: "expired" }`, `hooks.onCancelled` with `expired`; (12) the same with `uidplus` false → no reverse row; with a `ready` draft → the draft `expired` / `send_closed`; with an `applying` draft → the draft unchanged; with a `failed` draft and reason `draft_missing` → the hook with `draft_missing`; (13) a reminder send (`reminder: 1`) → no hook call; a clarification send → no hook call; (14) an `approved` send: reason `timeout` → false and unchanged; reason `held_timeout` with `locked_at` null → expired; with `locked_at` 1 min ago → false; with `locked_at` 11 min ago → expired; (15) an `applied`, `rejected` or `expired` send → false, no audit row; (16) `closeDraftOfSend` twice on an `applied` draft → one reverse row (the key); (17) `expireReminderActions`: a pending reminder pair (send `awaiting_approval`, draft `ready`) → both `expired` (`delegation_closed` / `send_closed`); a pair with the draft `applied` → the send expired and a reverse row with `reason: "expired"`; an `approved` reminder send with `locked_at` null → expired; an `applying` one → untouched; a delegation send (no `reminder` key) → untouched; an `applied` reminder → untouched; `sends` counts the expired rows; (18) `mailboxHasUidplus` true and false; another org's mailbox → false; (19) **lock order (S3 feature 4):** two connections (an own org, deleted at the end: the S3 D20 pattern, as `triage-settings-race.test.ts`); connection 1 opens a transaction and locks an `applying` reminder send of a `sent` delegation (`SELECT … FOR UPDATE`, as the committer's `finishAction` does); connection 2, with `SET LOCAL lock_timeout = '2s'`, runs `markAnswered` on that delegation → it returns true within the timeout (no wait on the `applying` row), the delegation `answered`, the `applying` row unchanged, and the `delegation.answered` audit row has `reminders_expired: 0`; connection 1 then commits. `delegation-service.test.ts`: `addDelegate` with the mailbox address → `mailbox_address`; a bad email → `invalid`; 11 tags → `invalid`; success → audit `delegate.added`; `createDelegation` with `"2026-11-10"` → `due_at` = 2026-11-10T16:00Z (17:00 Warsaw in November); with `"2026-02-30"` → null; `detectReply` with the delegate's address in another case → found; with another address → null; `markAnswered` on a delegation with a pending reminder pair whose draft is `applied` (mailbox `capabilities.uidplus` true) → `answered`, the send `expired` / `delegation_closed`, a reverse row for the draft; `closeDelegation` → `done`, then `already`; `cancelDelegation` → the reminders expired too.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: the chaser (stage 17), the triage call (stage 9), the notices (stage 15).

- [x] **7.2 CLIs `delegates:add | list | disable | enable` and `delegations:list | done` (D27, P3)**
  - Goal: the user manages delegates and closes delegations from the terminal before S5.
  - Files: create `apps/server/src/scripts/delegates.ts`, `apps/server/src/scripts/delegates-args.ts` (pure parsing, unit-tested), `delegates-args.test.ts`, `apps/server/src/scripts/delegations.ts`, `delegations-args.ts`, `delegations-args.test.ts`; change `package.json` (`"delegates:add": "bun apps/server/src/scripts/delegates.ts add"`, `delegates:list`, `delegates:disable`, `delegates:enable`, `"delegations:list": "bun apps/server/src/scripts/delegations.ts list"`, `delegations:done`), `deploy/README.md` (a "Delegates" section: the commands, the "never a mailbox address" rule).
  - Interfaces (usage text):

    ```
    bun run delegates:add     --org-id <uuid> --name <text> --email <address> [--tags a,b,c]
    bun run delegates:list    --org-id <uuid> [--all]          (default: active only)
    bun run delegates:disable --org-id <uuid> --id <uuid>
    bun run delegates:enable  --org-id <uuid> --id <uuid>
    bun run delegations:list  --org-id <uuid> [--status drafted|sent|answered|overdue|done|cancelled] [--limit 50]
    bun run delegations:done  --org-id <uuid> --id <uuid>
    ```

  - Decisions:
    - The pattern of `scripts/rules.ts`: `parseArgs`, Zod for the ids, `log.error(usage)` and exit 1 on bad arguments, `out()` to stdout for the user's own data. `delegates:add` prints `added <id>` or `already there`, `refused: the address is a mailbox of this organization`, `refused: <field>`; `list` prints one tab-separated line per delegate: id, active (`on` / `off`), name, email, tags. `delegations:list` prints id, status, delegate name, `cleanSubject(subject)`, due date, sent date, reminders. `delegations:done` prints `done <id>` / `already done` / `not found`. Actor `cli` in the audit rows. Exit codes 0 ok, 1 error or bad arguments, 2 refused.
    - Output holds the names, addresses and subjects the user asked for (their own data, to stdout, not through `log`).
  - Test: `delegates-args.test.ts` and `delegations-args.test.ts`: each subcommand parses; a missing `--email` fails; `--tags " A, b ,a"` → `["a", "b"]`; `--status nope` fails; `--limit 0` fails. Manual run on the dev DB: `delegates:add` for a `@localhost` address → an id; the same again → `already there`; the GreenMail mailbox address → `refused`; `delegates:list`; `delegates:disable --id`; `delegations:list` → empty.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`; the manual run.
  - Done when: the unit tests pass and the manual run matches.
  - Out of scope: a web page (S5), delegate edits other than active (S5).
