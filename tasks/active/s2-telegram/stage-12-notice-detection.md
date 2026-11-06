# s2-telegram — Stage 12

Part of [`../s2-telegram.md`](../s2-telegram.md). Read that file's "Input" and "Rules for every step" first.

## Stage 12 — Notice detection [risky]

- [x] **12.1 `detectNotices`: urgent, `auth_error`, sync late, sync works again**
  - Goal: each event gives exactly one outbox row per member who must get it (D4, D12, D13); a notice that is out of date before it was sent is cancelled.
  - Files: create `apps/server/src/modules/channels/notices.ts`, `apps/server/test/integration/channels-notices.test.ts`; change `apps/server/src/modules/channels/index.ts`.
  - Interfaces:
    - `interface NoticeDeps { db: Db | Transaction<DB>; now(): Date; startedAt: Date }` (`startedAt` = the process start time, from `main.ts`).
    - `detectNotices(deps: NoticeDeps): Promise<void>` — never throws.
    - Constants: `URGENT_LOOKBACK_MS = 24 * 3_600_000`; `URGENT_LIMIT = 200`; `SYNC_LATE_MS = 30 * 60_000`; `STALE_GRACE_AFTER_START_MS = 10 * 60_000`.
  - Decisions:
    - `now = deps.now()`; `links = listLinkedChats(db)` grouped by `orgId`; each organization in its own `try` / `catch` (an error → ``log.error(`notices for org ${orgId} failed: ${describeError(error)}`)``, then the next organization).
    - Per organization: `ctx = { orgId }`; the timezone from `getOrganization`; `mailboxes = listMailboxes(ctx)`; `members` = the org's links; `owners` = the links with role `owner`.
    - **Urgent** (D13: every linked member): `since(m) = max(m.linkedAt, now − URGENT_LOOKBACK_MS)`. One query: `listTriagedBetween(ctx, { after: min(since) − 1 ms, until: now }, { limit: URGENT_LIMIT, categories: ["urgent"] })`; drop rows whose mailbox is `paused` (P6). `listActionsForEmails` for the rows. For each member and each row with `triaged_at ≥ since(member)`: ``insertOutbox(ctx, { userId, kind: "urgent", dedupKey: `urgent:${email_id}`, emailId, message: renderUrgentNotice({ emailId, from, subject, aiText: aiTextFor({ category: "urgent", reasonCode, reason, summary: null, modelCategory, confidence }), receivedAt, synthetic: isSyntheticMessageId(message_id_header), wouldDo: describeActions(actions), now, timeZone }), createdAt: now, nextAttemptAt: now })``. The unique key makes a repeat a no-op.
    - **`auth_error`** (owners only): for each mailbox with status `auth_error`: `` key = `auth_error:${id}:${status_changed_at.getTime()}` ``; for each owner `insertOutbox(kind "auth_error", mailboxId, renderAuthErrorNotice({ address, mailboxId, since: status_changed_at, now, timeZone }))`; then `cancelPendingOutbox({ kind: "auth_error", mailboxId, exceptDedupKey: key })` (older episodes). For each mailbox with another status: `cancelPendingOutbox({ kind: "auth_error", mailboxId })`.
    - **Sync late / works again** (owners only), per mailbox:
      - status not `active` → `cancelPendingOutbox({ kind: "sync_stale", mailboxId })`; nothing else (a paused or `auth_error` mailbox gets no late notice).
      - Checkpoint 3 fix (2026-11-06): `fresh` = `last_synced_at` is set and `now − last_synced_at ≤ SYNC_LATE_MS`; `grace` = `now − status_changed_at ≤ SYNC_LATE_MS`, or never synced and `now − created_at ≤ SYNC_LATE_MS`. Not `fresh` and `grace` → `cancelPendingOutbox({ kind: "sync_stale", mailboxId })`, nothing else (no false "late" right after `/resume` or `mailbox:password`, and no `sync_ok` before a real sync). Not `fresh` and not `grace` = late. `fresh` = the "not late" branch below. (Original rule: `lastGood = last_synced_at ?? created_at`; late = `now − lastGood > SYNC_LATE_MS`.)
      - late and `now − startedAt ≥ STALE_GRACE_AFTER_START_MS` → `` key = `sync_stale:${id}:${last_synced_at?.getTime() ?? "never"}` ``; for each owner `insertOutbox(kind "sync_stale", mailboxId, renderSyncStaleNotice({ address, lastSyncedAt: last_synced_at, now, timeZone }))`; `cancelPendingOutbox({ kind: "sync_stale", mailboxId, exceptDedupKey: key })`. Late but inside the grace time → nothing.
      - not late → `cancelPendingOutbox({ kind: "sync_stale", mailboxId })`; then, only when `last_synced_at` is set, for each `{ userId, episode }` of `listSentStaleEpisodes(mailboxId)` whose `userId` is still a linked member: ``insertOutbox(kind "sync_ok", dedupKey `sync_ok:${id}:${episode}`, mailboxId, renderSyncOkNotice({ address, lastSyncedAt: last_synced_at, now, timeZone }))``.
    - When `insertOutbox` returns an id: ``log.info(`notice ${kind} queued: outbox ${id}`)``. No other log line per row.
    - Cost: one cheap query set per linked organization every 15 s (pilot: one organization).
  - Test (`channels-notices.test.ts`; `withRollback` + `isolateChannels(trx)`; `T` = `2026-11-06T10:00:00Z`; org A from `createOrgWithMailbox` with its owner linked at `T − 1 h` and an assistant (`addMember`) linked at `T − 1 h`; A's mailbox `active`, synced at `T − 5 min` (`markSynced`); `startedAt` = `T − 1 h`; results from `insertTriaged`; count rows with SQL on `outbox`):
    1. An `urgent` result at `T − 10 min` (with a `logged` `flag` action) → one `urgent` row for the owner and one for the assistant, key `urgent:<email id>`, the text contains `🔴 Urgent mail` and `→ would flag`, buttons `fr:u:<id>` / `fe:<id>`; a second run → still 2 rows.
    2. The assistant linked at `T − 5 min` and a result at `T − 10 min` → only the owner gets a row.
    3. A result at `T − 25 h` → no row; an `info` result → no row.
    4. The mailbox `paused` → no `urgent` row for its result.
    5. `auth_error` with `status_changed_at` = `S` → one row for the owner only, key `auth_error:<mb>:<S ms>`; a second run → still one. Then `active`, then `auth_error` again at `S2` → a second row with the `S2` key; the first row, still `pending`, is now `failed` / `outdated`.
    6. A `pending` `auth_error` row, and the mailbox is `active` again → the row is `failed` / `outdated`.
    7. Synced at `T − 40 min`, `startedAt` = `T − 5 min` → no row; `startedAt` = `T − 15 min` → one `sync_stale` row for the owner, key `sync_stale:<mb>:<ms>`; a second run → one.
    8. Never synced, the mailbox created at `T − 2 h` (update `created_at`) → key ends with `:never`, the text has `Last good sync: never.`
    9. The `sync_stale` row set to `sent` (with `sent_at`), then synced at `T − 1 min` → one `sync_ok` row `sync_ok:<mb>:<same episode>`; a second run → one. A `pending` `sync_stale` row and then a fresh sync → it is `failed` / `outdated`, and no `sync_ok` row.
    10. A `paused` mailbox synced at `T − 2 h` → no `sync_stale` row; an `auth_error` mailbox → no `sync_stale` row.
    11. Org B with its own linked owner and an `urgent` result → B's owner gets B's row; no row of A's members has B's e-mail id.
    12. Org A's `timezone` set to `Mars/Base` (direct update) → org B still gets its rows; one `error` line names org A's id.
    13. Checkpoint 3 fix: synced at `T − 2 h`, `active` with `status_changed_at` = `T − 1 min` → no `sync_stale` row; the same mailbox with a sent `sync_stale` row → no `sync_ok` until `markSynced(T)` and a next run.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: sending (stage 11), digests (stage 13), an admin notice for the LLM pause or the daily cap (open question for the user, not in S2).
