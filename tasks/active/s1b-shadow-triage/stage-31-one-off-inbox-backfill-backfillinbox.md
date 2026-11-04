# s1b-shadow-triage — Stage 31

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 31 — One-off INBOX backfill: `backfillInbox` [risky]

- [ ] **31.1 `backfillInbox` in `mail/sync.ts`**
  - Goal: a one-off, read-only fetch of older INBOX mail, up to 30 days back, that stores the missing mails with `backfilled_at` and never moves the UID cursor.
  - Files: change `apps/server/src/modules/mail/sync.ts` (new `backfillInbox`; `SyncResult["mode"]` gets `"backfill"`), `apps/server/src/modules/mail/index.ts` (export `backfillInbox`); create `apps/server/test/integration/mail-backfill.test.ts`.
  - Interfaces:
    - `backfillInbox(deps: SyncDeps, ctx: TenantContext, mailboxId: string, opts: { since: Date }): Promise<SyncResult>` (mode `"backfill"`).
  - Decisions (user decision 2026-11-04, answer 3):
    - Used only in step 39.1, and only when the shadow week gives fewer than 100 real triaged mails. Not a scheduled job.
    - INBOX only (the system never reads the user's own folders). Read-only on the mailbox: the `MailProvider` port has no write method; the code calls only `inboxStatus`, `searchInboxSince`, `fetchByUids`, `fetchBodyText` (and `findByMessageId` in the copy check, which needs a stored row outside INBOX: S1b has none). The installed imapflow 1.7.8 fetches the source with `BODY.PEEK`, so no mail gets `\Seen` (`node_modules/imapflow/lib/commands/fetch.js`, checked 2026-11-04).
    - Max 30 days back = the body retention (architecture §4.4, §7).
    - Reuse the rescan path of `syncMailbox`: `fetchSince(deps.provider, opts.since)` → `planChunk` per chunk → in every `insert` write set `row.backfilled_at = deps.now()` → `applyChunk(deps, ctx, mailboxId, writes, start, null, result)`. `next = null`: the cursor never moves. Never call `setCursor` or `updateCursor`. `start` = the cursor read at the start.
    - Preconditions, before any fetch: mailbox not found → `HardError("mailbox not found")`; `uidvalidity` NULL → `HardError("mailbox was never synced: run the sync first")`; `inboxStatus().uidValidity !== mailbox.uidvalidity` (UIDVALIDITY changed, or a forced rescan waits) → `SoftError("UIDVALIDITY changed: wait for the regular sync to rescan, then run the backfill again")`.
    - Concurrency with the 5-minute sync: `applyChunk` locks the mailbox row and checks that the cursor still equals `start`; if the regular sync moved it, `CursorMovedError` and that chunk is not stored. A re-run is safe: the dedup key `(mailbox_id, dedup_key)` with `ON CONFLICT DO NOTHING` stops duplicates, and a later incremental sync of a backfilled mail above the cursor finds the stored copy (`update_uid`).
    - Mail that is already stored keeps `backfilled_at` NULL (the `update_uid` path changes only `uid`). Stage 33 handles stored mail that the worker skipped as `too_old` (user answer Q29: (a)).
    - The waiver itself is in the worker (step 24.1). Backfilled mail goes through the normal worker, so it counts against `LLM_DAILY_CAP` (`llm.call` rows) and the shared quota; the claim order (oldest first) puts it before new mail.
    - Log lines: mailbox id and counts only.
  - Test (`mail-backfill.test.ts`, `withRollback`, the fake provider from `mail/fake` with a fixed clock, `createOrgWithMailbox`):
    1. `deliver` 4 INBOX mails with `internalDate` now − 40 d, − 20 d, − 10 d, − 2 h (uids 1–4). `syncMailbox` (initial, 1-day window) stores only the − 2 h mail; cursor = (uidvalidity, 4). `deliver` one more mail at now − 1 h (uid 5, above the cursor). `backfillInbox(since = now − 30 d)`: stored 3 (− 20 d, − 10 d, − 1 h), uid updated 1 (− 2 h); each stored row has `backfilled_at` = the fake now; the − 2 h row keeps `backfilled_at` NULL; the − 40 d mail is not stored; the cursor is still (uidvalidity, 4).
    2. A second `backfillInbox` stores 0.
    3. The next `syncMailbox` (incremental) finds uid 5 stored (`update_uid`), stores 0 and moves the cursor to 5; each Message-ID has exactly one row.
    4. `fake.resetUidValidity(…)` before the backfill → `SoftError`; nothing stored; `fake.calls` has no `searchInboxSince`.
    5. A mailbox that was never synced → `HardError`.
    6. Cursor moved during the backfill: a wrapper provider whose `fetchBodyText` first calls `updateCursor` on the same transaction → `CursorMovedError`; that chunk stored no row.
    7. Another org's context with this mailbox id → `HardError("mailbox not found")`.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: the tool and the CLI (stage 32), other folders, a change of the cursor, a scheduled job, re-queueing skipped mail (stage 33), running it on the VPS (step 39.1).
