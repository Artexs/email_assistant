# F088 stage 03 — Every producer queues `{ kind, view, locale }`

Part of [`../plan.md`](../plan.md). Decisions: D1, D6, D12–D16, D24. Needs stages 01 and 02 landed. Review job before the land. Three steps.

After this stage, no producer calls a render function. Every outbox row stores its view and its locale. The row still stores the text too, rendered from that view by the registry, so the sender does not change yet, and every existing assertion on `outbox.text` now checks the registry output (the byte-identical proof, D9). Stage 04 stops storing the text.

## Step 1 — `queueNotice`

**Goal.** One function through which every notice enters the outbox: it encodes the view, checks that it renders, and inserts the row.

**Files.** New: `apps/server/src/modules/channels/notice-queue.ts`. Changed: `apps/server/src/modules/channels/repo.ts` (`NewOutboxRow`: `view` and `locale` become required), `apps/server/src/modules/channels/index.ts` (export `queueNotice`, `type QueueNoticeInput`).

**Interfaces.**

```ts
export interface QueueNoticeInput<K extends NoticeKind> {
  userId: string;
  locale: UserLocale;
  kind: K;
  view: NoticeView<K>;
  dedupKey: string;
  emailId?: string;
  mailboxId?: string;
  digestId?: string;
  now: Date;
}

// The only producer path into `outbox` (ADR 0032 point 5): the row stores the view; a view that does not render never
// enters the outbox, so the caller skips the event as it did when the insert failed.
// null = the event has a row already (one row per event and member).
export async function queueNotice<K extends NoticeKind>(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: QueueNoticeInput<K>
): Promise<string | null>
```

Body: `const view = encodeNoticeView(input.kind, input.view);` → `const rendered = renderNotice(input.kind, view, { channel: "telegram", detail: "full", locale: input.locale });` → `if (!rendered.ok) throw new NoticeViewError(input.kind);` → `insertOutbox(db, ctx, { userId, kind, dedupKey, emailId, mailboxId, digestId, view, locale, message: rendered.message, createdAt: input.now, nextAttemptAt: input.now })`. Channel and detail are the constants `"telegram"` and `"full"` (the only values; E9b reads the user's choice here).

In `repo.ts`, `NewOutboxRow.view: Record<string, unknown>` and `locale: UserLocale` become required. Test files that call `insertOutbox` directly (`channels-outbox`, `channels-sender`, `channels-callbacks`, `delegation-schema`, `delete-mailbox`, `mail-remove`; `bun run typecheck` lists each call) get `view: {}, locale: "en"` added to the object and nothing else. Their `message` stays until stage 04.

**Decisions.** D14, D15, D16.

**Test.** `apps/server/test/integration/channels-outbox.test.ts`, new cases (own tenant per test, as the file does):

1. `queueNotice` with `kind: "sync_ok"`, a valid view (`address: "box@example.test"`, fixed dates, `timeZone: "Europe/Warsaw"`), `locale: "pl"` → a row whose `view.lastSyncedAt` is an ISO string, `locale = 'pl'`, and `text` equal to `renderSyncOkNotice(<the same input with Date values>).text`.
2. `queueNotice` with `kind: "digest"`, `view: { text: "x".repeat(4097), buttons: [] }` → throws `NoticeViewError`; no row exists for the dedup key.
3. `queueNotice` with an `urgent` view whose `emailId` is `"not-a-uuid"` → throws `NoticeViewError` (the check render fails, probe P4); no row.
4. The same `queueNotice` call twice → the second returns `null`; one row.
5. (Not verified fact of `plan.md`.) `queueNotice` with `kind: "sync_ok"` and `address: "a\ud800\u0000b@example.test"` → a row; its `view.address` is `"a� b@example.test"`.

**Check.** `bun test apps/server/test/integration/channels-outbox.test.ts`; `bun run typecheck`.

**Done when.** Tests 1–5 pass.

**Out of scope.** The producers (step 2). The sender.

## Step 2 — The producers pass views

**Goal.** No producer builds channel text (ticket acceptance; D13).

**Files.** `apps/server/src/modules/channels/notices.ts`, `apps/server/src/modules/channels/digest-job.ts`.

**Interfaces.** In `notices.ts`, the local helper becomes `queue<K extends NoticeKind>(db, ctx, input: Omit<QueueNoticeInput<K>, "now">, now: Date)` and calls `queueNotice(db, ctx, { ...input, now })`; it keeps its log line `notice ${kind} queued: outbox ${id}`. Each call site passes `locale: member.locale` (or `owner.locale`, `chat.locale`) and a `view` instead of `message`. Remove the `render…` imports from `@ea/core` that become unused. The exact views:

| Producer | `view` |
| --- | --- |
| `detectUrgent` | `{ emailId: row.email_id, from: row.from_address, subject: row.subject, ai: { reasonCode: row.reason_code, reason: row.reason }, receivedAt: row.received_at, synthetic: isSyntheticMessageId(row.message_id_header), folderTag: row.source_folder === INBOX ? null : row.source_folder, actions, delegateNames, stayFolder: row.folder, now, timeZone }` where `actions = (<the Map that `listActionsForEmails` returned, called `actions` in the code today>.get(row.email_id) ?? []).map(({ type, status, folder, reverse, kind, delegateId }) => ({ type, status, folder, reverse, kind, delegateId }))` (the strict schema refuses the other fields of `ActionView`) and `delegateNames` = an object with the name of each `delegateId` of these actions that `names` has (`Object.fromEntries(...)`). |
| `detectActionFailed` | the object that is passed to `renderActionFailedNotice` today, unchanged, built once before the owner loop |
| `detectAuthError` | `{ address: mailbox.address, mailboxId: mailbox.id, since: mailbox.status_changed_at, now, timeZone }` |
| `detectSync` (stale) | `{ address: mailbox.address, lastSyncedAt: mailbox.last_synced_at, now, timeZone }` |
| `detectSync` (ok) | `{ address: mailbox.address, lastSyncedAt: mailbox.last_synced_at, now, timeZone }` (here `last_synced_at` is not null; the code returns before when it is) |
| `detectApprovals` | `{ actionId: row.id, view, now, timeZone }` (`view` from `approvalViewFor`) |
| `detectApprovalSets` | `{ setId, items, timeZone }` |
| `detectSendResults` | `{ actionId: row.id, sendKind, result: await resultKindOf(…), recipient: { name: stringOf(draftRow?.payload.delegate_name), address: to ?? draftTo }, subject: outgoingSubject(sendKind, row.email.subject), synthetic: isSyntheticMessageId(row.email.message_id_header) }` (the `"(unknown)"` fallback moves into the renderer, D13) |
| `detectDelegationAnswered` | `{ delegationId: row.id, delegateName: row.delegate_name, subject: row.subject, receivedAt: answer?.received_at ?? row.answered_at ?? now, now, timeZone, synthetic: isSyntheticMessageId(answer?.message_id_header ?? null) }` |
| `queueMailboxRemovedNotices` | `{}`, through `queueNotice` with `locale: chat.locale` (no `mailboxId`, no `emailId`, as today) |
| `digest-job.ts` `scheduleForLink` | `{ text: message.text, buttons: message.buttons }` with `locale: link.locale`, through `queueNotice` |

The transactions stay as they are: a producer that marks its source row (`markNotified`, `markResultNotified`, `markAnsweredNotified`) does it in the same transaction as its `queueNotice` calls, so a `NoticeViewError` rolls back the mark and the producer's `catch` warns once (`warnSkipped`), as an insert error did before. In `detectApprovals`, `detectApprovalSets`, `detectSendResults` and `detectDelegationAnswered` the view is built before the transaction (where the message was built before). In the digest job, a `NoticeViewError` rolls back the digest row too, as the existing comment says.

`warnSkipped` keeps `describeError(error)`: a `NoticeViewError` message holds only the kind (D15, D24).

**Decisions.** D1, D12, D13, D15, D16.

**Test.** Existing integration tests pass with no change to any assertion: `channels-notices`, `channels-digest-job`, `channels-callbacks`, `channels-sender`, `actions-logs`, `actions-send-logs`, `actions-resume-approvals`, `mail-remove`, `web-mailboxes`, `telegram-logs`. New cases in `channels-notices.test.ts` (extend the `rows` helper at line 100 to also select `view` and `locale`):

1. After a run with an urgent mail, a failed action, an auth error, a late sync, a waiting send and an answered delegation (reuse the existing setups), every row has a non-empty `view` and `locale = 'en'` for a member whose `users.locale` is `'en'`.
2. A member whose `users.locale` is null gets rows with `locale = 'pl'` and the same English text as a member with `'en'` (D16).
3. The urgent row's view has the keys `ai`, `actions`, `delegateNames`, `stayFolder` and no key `wouldDo` or `aiText`; each entry of `view.actions` has exactly the keys `type`, `status`, `folder`, `reverse`, `kind`, `delegateId`.
4. In the test "(8)(9) tenant isolation; no sender address and no body text in a result" (line 1246), add: `JSON.stringify(row.view)` of each `send_result` row contains neither `SENDER` nor `BODY`.

New case in `channels-digest-job.test.ts`: the queued digest row has `view.text` equal to its `text`.

New case in `mail-remove.test.ts`: the `mailbox_removed` row has `view = {}` and no address in `view::text` (extend the `ILIKE` check at line 201 to `text ILIKE … OR view::text ILIKE …`).

**Check.** `bun test apps/server/test/integration/channels-notices.test.ts apps/server/test/integration/channels-digest-job.test.ts apps/server/test/integration/mail-remove.test.ts apps/server/test/integration/channels-callbacks.test.ts`; `bun run typecheck`; `grep -n "render[A-Z][A-Za-z]*(" apps/server/src/modules/channels/notices.ts apps/server/src/modules/channels/digest-job.ts` prints nothing.

**Done when.** The new cases pass; `git diff` of the existing test files shows only added cases, the `rows` helper select and the `view: {}, locale: "en"` lines of step 1.

**Out of scope.** Splitting `notices.ts` (stage 05). The digest content (`reports` builds it as today).

## Step 3 — Module graph and the stage proof

**Goal.** The stage adds no module edge.

**Files.** None.

**Check.** `bun run graph:modules` then `git status --short docs/diagrams` prints nothing (channels already imports every module it uses). If it prints a change, stop and report the new edge.

**Done when.** The Proof of `plan.md` with `NN` = `03` ends with `PROOF_OK`.

**Out of scope.** —
