# s2-telegram — Stage 10

Part of [`../s2-telegram.md`](../s2-telegram.md). Read that file's "Input" and "Rules for every step" first.

## Stage 10 — Outbox repository [risky]

- [ ] **10.1 Outbox rows: insert with dedup, claim, sent, release, fail, cancel**
  - Goal: exactly one outbox row per event (D4), claimed with `FOR UPDATE SKIP LOCKED`, and every status change guarded by the claim token (`locked_at`), as the S1b e-mail claim does.
  - Files: change `apps/server/src/modules/channels/repo.ts` (outbox part), `apps/server/src/modules/channels/index.ts`, `apps/server/test/integration/fixtures.ts` (`isolateChannels`); create `apps/server/test/integration/channels-outbox.test.ts`.
  - Interfaces (`channels/repo.ts`):
    - `const outboxKinds = ["digest", "urgent", "auth_error", "sync_stale", "sync_ok"] as const`; `type OutboxKind`.
    - `const outboxFailCodes = ["blocked", "bad_request", "expired", "no_chat", "outdated", "too_many_errors"] as const`; `type OutboxFailCode`.
    - `interface NewOutboxRow { userId: string; kind: OutboxKind; dedupKey: string; emailId?: string; mailboxId?: string; digestId?: string; message: OutMessage; createdAt: Date; nextAttemptAt: Date }`
    - `insertOutbox(db: DbOrTrx, ctx: TenantContext, row: NewOutboxRow): Promise<string | null>` — `ON CONFLICT (org_id, user_id, dedup_key) DO NOTHING`; null = the event has a row already.
    - `interface ClaimedOutbox { id: string; orgId: string; userId: string; kind: OutboxKind; text: string; buttons: OutButton[][]; attempts: number; lockedAt: Date; createdAt: Date; digestId: string | null; wasStale: boolean }`
    - `claimDueOutbox(db: DbOrTrx, opts: { now: Date; limit: number; staleBefore: Date; orgIds?: readonly string[] }): Promise<ClaimedOutbox[]>` — scheduler entry point (D18). `orgIds` is for the two-connection test only (a dev DB can hold other due rows); production code never passes it.
    - `markOutboxSent(db: DbOrTrx, ctx: TenantContext, id: string, lockedAt: Date, sent: { messageId: number; at: Date }): Promise<boolean>`
    - `releaseOutbox(db: DbOrTrx, ctx: TenantContext, id: string, lockedAt: Date, opts: { nextAttemptAt: Date; countAttempt: boolean }): Promise<boolean>`
    - `failOutbox(db: DbOrTrx, ctx: TenantContext, id: string, lockedAt: Date, code: OutboxFailCode): Promise<boolean>`
    - `cancelPendingOutbox(db: DbOrTrx, ctx: TenantContext, filter: { kind: "auth_error" | "sync_stale"; mailboxId: string; exceptDedupKey?: string }): Promise<number>`
    - `listSentStaleEpisodes(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<{ userId: string; episode: string }[]>`
    - Fixture `isolateChannels(trx: Transaction<DB>): Promise<void>` — inside the test transaction: delete all `chat_links` rows, and set every `pending` / `sending` outbox row to `failed` with `error_code` `outdated` and `locked_at` NULL (the rollback undoes both).
  - Decisions:
    - Dedup key formats (stage 12 and 13 build them; written here so every stage uses the same): `urgent:<emailId>`; `auth_error:<mailboxId>:<status_changed_at as epoch ms>`; `sync_stale:<mailboxId>:<last_synced_at as epoch ms, or never>`; `sync_ok:<mailboxId>:<the same last part as its sync_stale key>`; `digest:<slotKey>`.
    - `insertOutbox` stores `text` = `message.text`, `buttons` = `JSON.stringify(message.buttons)`, `status` `pending`, `attempts` 0, `created_at` = `createdAt`, `next_attempt_at` = `nextAttemptAt` (the app clock, never the DB `now()`).
    - Claim SQL (Kysely in the S1b `claimEmails` style; the `sql` template only where Kysely cannot type it):
      ```sql
      WITH picked AS (
        SELECT id, status = 'sending' AS was_stale FROM outbox
        WHERE ((status = 'pending' AND next_attempt_at <= $now) OR (status = 'sending' AND locked_at < $staleBefore))
          [AND org_id IN (...orgIds)]
        ORDER BY created_at, id
        LIMIT $limit
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox o SET status = 'sending', locked_at = $now
      FROM picked WHERE o.id = picked.id
      RETURNING o.id, o.org_id, o.user_id, o.kind, o.text, o.buttons, o.attempts, o.locked_at, o.created_at, o.digest_id, picked.was_stale
      ```
      Sort the result by `created_at`, then `id` (RETURNING has no order). Parse `buttons` with `outButtonsSchema` and `kind` with `z.enum(outboxKinds)`. The claim does not change `attempts`. `locked_at` = the JS `now` value (the token must survive the round trip exactly, as in S1b).
    - `markOutboxSent`: `status = 'sent'`, `sent_at = at`, `external_message_id = messageId`, `locked_at = NULL`, `error_code = NULL`, only `WHERE org_id AND id AND status = 'sending' AND locked_at = lockedAt`.
    - `releaseOutbox`: `status = 'pending'`, `locked_at = NULL`, `next_attempt_at = nextAttemptAt`, `attempts = attempts + 1` only when `countAttempt`; same guard.
    - `failOutbox`: `status = 'failed'`, `locked_at = NULL`, `error_code = code`; same guard.
    - `cancelPendingOutbox`: `status = 'failed'`, `error_code = 'outdated'` for `pending` rows of this kind and mailbox (not `sending`: a row in flight finishes), except `exceptDedupKey`; returns the number of rows.
    - `listSentStaleEpisodes`: `sync_stale` rows of the mailbox with status `sent`, with no row of the same member whose `dedup_key` = `'sync_ok:' || mailbox_id::text || ':' || split_part(dedup_key, ':', 3)`; `episode` = `split_part(dedup_key, ':', 3)`.
    - No function logs anything; the sender (stage 11) logs ids, kinds and codes.
  - Test (`channels-outbox.test.ts`; `withRollback` + `isolateChannels(trx)` first, except test 10; `T` = `2026-11-06T10:00:00Z`; members from `createOrgWithMailbox` and `addMember`):
    1. `insertOutbox` → an id; the same member and key again → null; another member with the same key → an id.
    2. `claimDueOutbox({ now: T, limit: 10, staleBefore: T − 5 min })`: due rows come back in `created_at` order with `wasStale` false, `buttons` parsed, status `sending`, `locked_at` = `T`; a row with `next_attempt_at` = `T + 1 min` is not claimed; `limit: 1` → one row.
    3. A `sending` row with `locked_at` = `T − 6 min` → claimed again with `wasStale` true; a `sending` row with `locked_at` = `T − 1 min` → not claimed.
    4. `markOutboxSent` with the claim's `lockedAt` → true; `status` `sent`, `sent_at`, `external_message_id`; with another `lockedAt` → false; a second call → false.
    5. `releaseOutbox(countAttempt: true)` → `pending`, `attempts` 1, the new `next_attempt_at`; `countAttempt: false` → `attempts` unchanged.
    6. `failOutbox(…, "blocked")` → `failed` / `blocked`.
    7. `cancelPendingOutbox({ kind: "auth_error", mailboxId })`: the `pending` rows of that kind and mailbox → `failed` / `outdated`, the return value counts them; a `sending` row, a row of another mailbox and the `exceptDedupKey` row stay as they were.
    8. `listSentStaleEpisodes`: a `sent` `sync_stale:<mb>:1730000000000` row → `[{ userId, episode: "1730000000000" }]`; after an insert of `sync_ok:<mb>:1730000000000` for the same member → `[]`; a `pending` stale row → not listed.
    9. Tenant guard: `markOutboxSent`, `releaseOutbox`, `failOutbox` with another org's context → false; `cancelPendingOutbox` → 0; `listSentStaleEpisodes` → `[]`.
    10. Two connections (no rollback; a new org, deleted at the end with `DELETE FROM organizations WHERE id = …`): insert 4 due rows; connection 1 opens a transaction and claims with `limit: 2, orgIds: [org]` (no commit yet); connection 2 claims with `limit: 10, orgIds: [org]` → exactly the other 2 rows; then connection 1 commits; all 4 rows are `sending`, each claimed once.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int` (run twice).
  - Done when: the tests pass in both runs.
  - Out of scope: the sending rules (stage 11), when rows are made (stages 12, 13). **User checkpoint 2 after this stage** (group review of stages 1, 6, 8, 9, 10).
