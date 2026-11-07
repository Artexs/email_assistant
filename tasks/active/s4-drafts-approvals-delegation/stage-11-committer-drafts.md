# s4-drafts-approvals-delegation — Stage 11

Part of [`../s4-drafts-approvals-delegation.md`](../s4-drafts-approvals-delegation.md). Read that file's "Input" and "Rules for every step" first.

## Stage 11 — Committer: `create_draft` (APPEND, recovery) and the draft removal [risky]

Checkpoint 1 input: stage 1 settled the Interia draft facts. If `draft.headerFetched` was false, stage 6 changed the locate to the ENVELOPE id; this stage does not change. If `draft.deleted` or `goneAfterDelete` was false at Interia, the reverse rows of 11.2 are never inserted for that mailbox (the `uidplus` dependency returns false), and the result texts say "the draft stays".

- [ ] **11.1 `applyAction` for an original `create_draft`: compose, resolve, locate, APPEND, recovery (D8, D9, D12, D14, D33)**
  - Goal: a `ready` draft ends as exactly one message in the Drafts folder with the system's header, whatever happened before (a crash after the APPEND, a retry after an error), and the row carries the uid for the later removal.
  - Files: create `apps/server/src/modules/actions/drafts.ts`, `apps/server/test/integration/actions-drafts.test.ts` (`expireSend` and `closeDraftOfSend` exist since stage 7.1: this stage only calls them); change `apps/server/src/modules/actions/apply.ts` (S3 stage 8), `actions/committer.ts` (S3 stage 8.2: `createFolderResolver` for `drafts` / `sent`; the owner, the organization and `compose` in the deps; `isMailboxChanging` (`committer.ts:84`) extended, so the IMAP provider opens for a batch with a draft, D17, M9), `actions/index.ts`, `apps/server/src/modules/mail/repo.ts` (`setFolderMapEntry(db, ctx, mailboxId, key: FolderKey, path)`, `repo.ts:509-514`: `key` widens to `FolderKey | "drafts" | "sent"`; M8) and `mail/index.ts` (export `composeMessage`).
  - Interfaces:

    ```ts
    // apply.ts (D33)
    export interface ApplyDeps {
      db;
      now(): Date;
      mailboxId: string;
      folders: FolderResolver; // resolve(key: FolderKey | "drafts" | "sent"): Promise<string>
      mailbox: { address: string; capabilities: { uidplus: boolean }; folderMap: Record<string, string> };
      owner: { displayName: string };
      organization: { styleText: string | null; timezone: string };
      compose(message: OutgoingMessage): Promise<Buffer>;
      sender: MailSender | null; // stage 12
      hooks: DelegationHooks;
      beforeCommit?: () => void; // S3 test hook: after the provider write, before the final transaction
      beforeSend?: () => void; // stage 12
      afterSend?: () => void; // stage 12
      beforeSentCopy?: () => void; // stage 12: after the `applied` transaction, before the Sent copy step (a crash test hook)
    }
    export type ApplyOutcome =
      | { kind: "applied" }
      | {
          kind: "failed";
          reason:
            | "mail_not_found"
            | "hard_error"
            | "no_provider"
            | "bad_payload"
            | "smtp_rejected"
            | "smtp_error"
            | "outcome_unknown";
        }
      | { kind: "expired"; reason: "send_closed" } // an `applying` draft whose send ended before the APPEND (N12)
      | { kind: "retry"; soft: boolean }
      | { kind: "auth_error" }
      | { kind: "lost" };
    // drafts.ts
    export function buildDraftMessage(deps: ApplyDeps, action: ClaimedAction): OutgoingMessage; // parses the payload (draftPayloadSchema), builds the BuildInput from action.email and the deps
    export async function applyDraft(
      deps: ApplyDeps,
      ctx,
      action: ClaimedAction,
      provider: MailProvider
    ): Promise<ApplyOutcome>;
    export async function removeDraft(
      deps: ApplyDeps,
      ctx,
      action: ClaimedAction,
      provider: MailProvider
    ): Promise<ApplyOutcome>; // 11.2
    ```

  - Decisions:
    - `applyAction` routes `create_draft` originals (`reverses_action_id` null) to `applyDraft` and reverses to `removeDraft`; `provider` null → the S3 guard (`retry` soft + an error line).
    - `applyDraft`, step by step: (1) status `ready` → `markApplying(id, lockedAt)` (own commit) + audit `action.applying`; false → `lost`. A claimed `applying` row (recovery) skips this. (2) `payload` parse with `draftPayloadSchema`; a failure → `failed` / `bad_payload` through **the failure transaction**: `finishAction(failed)`, audit `action.failed`, then for each send of this draft in `awaiting_approval` (`listSendsOfDraft`) `expireSend(trx, ctx, sendId, { reason: "draft_missing", now, actor: "system", hooks: deps.hooks, uidplus: deps.mailbox.capabilities.uidplus })` (stage 7.1: the send `expired` / `draft_missing`, the delegation `cancelled` / `draft_missing` for a delegation send, the `send_result` notice of D20 later). (3) `message = buildDraftMessage(deps, action)`; `raw = await deps.compose(message)`; `folder = await deps.folders.resolve("drafts")` (`folderMap.drafts`, else `Drafts`; `ensureFolder` writes the real path into `folder_map.drafts` when it differs, as S3 D9 does for `AI/*`). (4) `found = await locateByActionId(provider, folder, { actionId: action.id, hintUid: provider_result?.uid ?? null, since: action.created_at })`; found → result `{ uid: found.uid, folder, found: true }`; else, **when no send of this draft is open** (`listSendsOfDraft`: none in `awaiting_approval`, `approved`, `applying`; the send was rejected or expired while the draft waited or crashed) → one transaction `finishAction({ status: "expired", reason: "send_closed" })` + audit `action.expired` → `expired` (no APPEND for a dead send, N12); else `appended = await provider.appendMessage(folder, raw, ["\\Draft"], action.created_at)` → `{ uid: appended.uid, folder, found: false }`. (5) `deps.beforeCommit?.()`; one transaction: `finishAction({ status: "applied", at: now, providerResult: result })` (false → `lost`; the APPEND stays: the next claimer's locate finds it), audit `action.applied` (`data: { action_type: "create_draft", kind: payload.kind, found }`), and then, in the same transaction, `listSendsOfDraft` again: no open send (a reject or an expiry came during the APPEND or before the recovery) → `closeDraftOfSend(trx, ctx, action.id, { reason: <"rejected" when a send of the draft is `rejected`, else "expired">, now, uidplus: deps.mailbox.capabilities.uidplus })` (stage 7.1: the reverse row removes the draft; a reject that runs at the same moment and locks the draft after this commit also inserts it: the `${draftId}:undo` key keeps one row).
    - Errors: from steps 2–4 before `appendMessage` (compose, resolve, locate): `MailAuthError` → `auth_error` (the row stays `applying` and locked; the job releases the batch with `releaseActions`, which keeps `applying` with `locked_at` null → the next claim recovers); `SoftError` → `releaseAction({ toStatus: "ready", nextAttemptAt: now + 5 min, countAttempt: false })` → `retry soft`; other errors → `attempts + 1 >= 3` ? the failure transaction of step 2 with reason `hard_error` and `last_error` = `describeError` : `releaseAction({ toStatus: "ready", nextAttemptAt: now + 5 min, countAttempt: true, lastError })` → `retry hard`. From `appendMessage` itself (the server may have stored the message): `SoftError` → `releaseAction({ toStatus: "applying", nextAttemptAt: now + 5 min, countAttempt: false })`; other → `attempts + 1 >= 3` ? the failure transaction : `releaseAction({ toStatus: "applying", nextAttemptAt: now + 5 min, countAttempt: true })`; a recovery claim then runs step 4 (locate first) before a second APPEND. The failure transaction is the one of step 2 (`expireSend` per open send of the draft, stage 7.1), so the send ends `expired` / `draft_missing`, the delegation `cancelled` / `draft_missing`, and the `send_result` notice of D20 tells the user. A failed original draft gets **no** S3 `action_failed` notice (one failure, one notice: `listFailedUnnotified` leaves original drafts out, D33); a failed reverse draft keeps it (11.2).
    - `buildDraftMessage` builds `BuildInput` from `action.email` (`fromAddress`, `subject`, `receivedAt`, `messageId: message_id_header`, `inReplyTo: in_reply_to`, `references: references_header?.split(/\s+/) ?? []`, `bodyText`), `deps.mailbox.address`, `deps.owner`, `deps.organization`, `draftActionId: action.id`, `createdAt: action.created_at`.
    - The committer job (S3 8.2) loads per organization once per run: `getOrganization` (`styleText`, `timezone`) and the owner = the first `owner` row of `listMemberships` (its order: `memberships.created_at`, then `users.email`; stage 15.1 uses the same rule, so the approval message and the sent mail show the same `From` name); per mailbox the `folderMap`, `address`, `capabilities`; it passes `compose: composeMessage` and `hooks` from its deps. `FolderResolver.resolve("drafts" | "sent")` caches per run like the `AI/*` keys. In `createFolderResolver` (`committer.ts:39-82`) the default path is `AI_FOLDER_NAMES[key]` today (`committer.ts:56`): add the defaults `{ drafts: "Drafts", sent: "Sent" }` for the two new keys (`map[key] ?? DEFAULT_PATHS[key]`), and widen the cache key type to `FolderKey | "drafts" | "sent"` (M8).
    - **When the committer opens the IMAP provider (M9).** The S3 committer decides after the claim: `if (batch.some(isMailboxChanging))` (`committer.ts:217`), with `isMailboxChanging` = `MAILBOX_ACTION_TYPES` (`committer.ts:84`); `countClaimable` is only the `total === 0` early return (`:210-211`). Extend `isMailboxChanging` to `MAILBOX_ACTION_TYPES` plus `create_draft` and `send` (a draft and its reverse need IMAP; a send needs it for the Sent copy and the recovery: stage 12). Do not use `countClaimable` for this decision. `save_summary` still opens nothing.
    - **The S3 batch release (S3 feature 7, `committer.ts:136-152`, `:182-185`).** An error of the open (`openFor`) releases the whole batch with `releaseActions`; an `auth_error` outcome releases `batch.slice(index)`, **including the row in work**; a soft `retry` releases the rows after it. `releaseActions` clears `locked_at` and keeps the status (stage 10.1), so after a `MailAuthError` inside `applyDraft` the row is `applying` with `locked_at` null when the job ran it, and `applying` and still locked only when a test calls `applyDraft` directly. Test (9) below calls it directly.
    - **`clearUndoPending` (S3 feature 3, `apply.ts:56`):** the S3 `failAction` and `mapProviderError` call it; it acts only for a reverse `move` (it clears `emails.undo_pending_at`), so it changes nothing for a draft. `applyDraft` and `removeDraft` do not call it and write no `emails` row.
    - The committer job (S3 8.2) treats the new outcome `expired` like `applied` for the run (continue with the next action; no release) and counts it in the info line as `closed <n>`.
    - Log lines: `action <id>: applied create_draft` (debug), `action <id>: closed create_draft (send_closed)` (info), `action <id>: failed <reason>` (warn), `action <id>: <Class code>, try <n> of 3` (warn). Never the subject, the recipient or the text.
  - Test (`actions-drafts.test.ts`, `withRollback`, the fake provider with `capabilities.uidplus` true and a `Drafts` folder, `compose` = `composeMessage`, fixtures `insertDraftAndSend` with `draftStatus: "ready"`): (1) a delegation draft → the fake `Drafts` holds one message with `actionId` = the draft id, `messageId` `<ea-<id>@…>`, flags `\\Draft`, `internalDate` = `created_at`; the row `applied` with `provider_result` `{ uid, folder: "Drafts", found: false }`; audit `action.applying` and `action.applied`; the stored raw holds the quoted original body (`fake` keeps `raw`); (2) a second `applyDraft` on a new claim of the same row after `beforeCommit` threw once (**crash test, done-when**): the row is `applying` and locked after the throw; the fake has one message; the second call (the claim with `locked_at` 11 min ago) → `applied` with `found: true`, still one message, `fake.calls` has one `appendMessage`; (3) a `folder_map` without `drafts` → the folder `Drafts` is created (`ensureFolder`) and written into `folder_map.drafts`; (4) `failOn("appendMessage", new SoftError())` → `retry soft`, the row `applying`, `locked_at` null, `next_attempt_at` +5 min, `attempts` 0; then a claim and `applyDraft` again → the locate finds nothing (the fake stored nothing on the failure) → APPEND → `applied`; (5) `failOn("appendMessage", new HardError())` three times across three claims → `attempts` 1, 2, then `failed` / `hard_error`; the send `expired` / `draft_missing` with `result_notified_at` null (the D20 detector lists it); `hooks.onCancelled` called with `draft_missing`; `listFailedUnnotified` (S3) does not list the failed original draft; (6) a bad payload (a `kind` `nope` inserted by SQL) → `failed` / `bad_payload` and the send expired; (7) a clarification draft → `to` = the sender, subject `Re: …`, `inReplyTo` set; (8) a reminder draft (payload with `thread`) → no quote in the raw, `inReplyTo` = the thread's; (9) `MailAuthError` from `ensureFolder`, `applyDraft` called directly → `auth_error`, the row `applying` and still locked; the same through one committer job run → the row `applying` with `locked_at` null (the job releases `batch.slice(index)`, S3 feature 7) and the mailbox `auth_error`; (10) every audit row has `action_id` and `email_id`; (10b) **N12, a dead send:** an `applying` draft with `locked_at` null (released after an APPEND error, the fake stored nothing) whose send is `rejected` → `applyDraft` → `expired` / `send_closed`, no `appendMessage` call; (10c) the same, but the fake `Drafts` holds the message (the APPEND had landed) → `applied` with `found: true` and a reverse row with `reason: "rejected"` (`uidplus` true); (10d) **in flight:** `beforeCommit` runs `reject` (stage 10.2) on the send before the final transaction (the reject sees the draft `applying` and inserts no reverse) → the draft `applied` and exactly one reverse row, inserted by the final transaction.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass, including the crash test.
  - Out of scope: the send (stage 12), the removal (11.2).

- [ ] **11.2 The draft removal: the reverse `create_draft` row (D13)**
  - Goal: a reverse row removes the system's draft from the Drafts folder once, marks the original `undone` with the reason, and never touches another message.
  - Files: change `apps/server/src/modules/actions/drafts.ts`, `apps/server/test/integration/actions-drafts.test.ts`, `packages/core/src/digest/notices.ts` (the `action_failed` text for a reverse `create_draft`: `⚠️ Could not remove the draft for a mail` / `The draft stays in Drafts: delete it by hand.`; `renderActionFailedNotice`'s `actionType` widens to `"move" | "flag" | "mark_read" | "create_draft"`), `packages/core/src/digest/notices.test.ts`, `apps/server/src/modules/channels/notices.ts` (`detectActionFailed`: stage 3.2 narrowed it to `MAILBOX_ACTION_TYPES`; let a reverse `create_draft` row through too, so its notice goes out; M16).
  - Decisions:
    - `removeDraft`: the payload (`{ kind, folder, uid, reason }`, Zod) names the folder and the hint; `found = locateByActionId(provider, payload.folder, { actionId: action.reverses_action_id, hintUid: payload.uid, since: <the original's created_at: ClaimedAction gets the original's created_at through a join: `original_created_at`> })`; found → `provider.deleteMessage(folder, found.uid)` (S3 D1: `\Deleted` + `UID EXPUNGE`; the fake and GreenMail return true); not found → nothing (`provider_result.found = false`); `deps.beforeCommit?.()`; one transaction: `finishAction(applied, { providerResult: { found, uid } })`, `markUndone(original, { at: now, reason: payload.reason })` (S3 7.1b; its `reason` type widens from `"undo" | "user_moved_back"` (`repo.ts:429`) to also `"sent" | "rejected" | "expired"`: change it in this step; `status_reason` = the reason), audit `action.applied` (`data: { action_type: "create_draft", reverse: true, found }`) and `action.undone` on the original (`data: { reverse_action_id, reason }`). Idempotent: a repeat finds nothing and still marks the original `undone`. **Lock order (S3 `9f9f166`, S3 feature 4):** in the final transaction call `finishAction` of the reverse row first, then `markUndone` of the original (the order of the S3 reverse `move`, `apply.ts:218-220`), and write no `emails` row (a draft has no location columns of its own).
    - Errors as S3 D7: soft → `retry` without a count; hard → 3 tries → `failed` + the S3 `action_failed` notice (text above); `mail_not_found` never applies (not found = done). `HardError("no UIDPLUS")` from `deleteMessage` cannot happen: the reverse is inserted only with UIDPLUS (D13); if it does, it counts as hard.
    - A reverse row is claimed under the `mailbox` filter like an original draft (D16, D17); no age rule.
  - Test (`actions-drafts.test.ts`): (11) an applied draft in the fake `Drafts` + a reverse row (`insertReverse` with the payload) → after `applyAction` the fake `Drafts` is empty, the reverse `applied` with `found: true`, the original `undone` / `sent` (the payload reason), audit `action.undone`; (12) the draft is already gone → `applied` with `found: false`, the original `undone`; (13) another draft of another action in the same folder stays; (14) `failOn("deleteMessage", new HardError())` ×3 → `failed` / `hard_error`, the original still `applied`, `notified_at` null; (15) **crash:** `beforeCommit` throws after the delete → the reverse stays `ready` and locked; a stale claim and a second `applyAction` → `applied` with `found: false` (the message is gone), the original `undone`; `deleteMessage` was called once. `notices.test.ts`: the reverse `create_draft` text.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: who inserts the reverse rows (stages 10.2, 12, 13).
