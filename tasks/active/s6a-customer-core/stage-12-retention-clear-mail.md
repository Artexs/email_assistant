# s6a-customer-core — Stage 12

Part of [`../s6a-customer-core.md`](../s6a-customer-core.md). Read that file's A22–A25, "Facts checked" F6–F7, "Differences found at collect" item 7 and "Rules for every step" first, the master plan's D5, `spec/features/planned/F027-retention-job/plan.md` (the old `retention-job.md`) and `docs/architecture.md` §7 (the retention table).

## Stage 12 — Retention: index migration, the `mail` and `triage` clear functions, the backfill guard [risky]

One step. Stage 13 writes the other clear functions; stage 14 builds the job.

- [ ] **12.1 Migration `retention_indexes`, `clearMailBodies`, `clearMailHeaders`, `clearTriageTexts`, `requeueTooOld` guard**
  - Goal: the mail texts and the triage texts of one organization can be cleared after their period, in small batches, for every mailbox status and every plan, and a repeat call changes nothing (D5).
  - Files:
    - create `db/migrations/20261112100002_retention_indexes.sql` (next free version after stage 4's file); run `bun run db:types` (expected: no change in `schema.ts`; if it changes, log why);
    - change `apps/server/src/modules/mail/repo.ts` + `index.ts` (`clearMailBodies`, `clearMailHeaders`; the `requeueTooOld` guard at `repo.ts:1086-1100`);
    - change `apps/server/src/modules/triage/repo.ts` + `index.ts` (`clearTriageTexts`);
    - create `apps/server/test/integration/retention-clear.test.ts`; add one test to the file that tests `requeueTooOld` (`triage-requeue.test.ts` or `mail-backfill.test.ts`; grep `requeueTooOld`).
  - Interfaces (tenant-scoped; each returns the number of rows changed; `RETENTION_BATCH = 1000` is a local constant of each repo):

    ```ts
    // mail/repo.ts
    export function clearMailBodies(
      db: DbOrTrx,
      ctx: TenantContext,
      opts: { before: Date; pendingBefore: Date; batch?: number }
    ): Promise<number>;
    export function clearMailHeaders(
      db: DbOrTrx,
      ctx: TenantContext,
      opts: { before: Date; batch?: number }
    ): Promise<number>;
    // triage/repo.ts
    export function clearTriageTexts(
      db: DbOrTrx,
      ctx: TenantContext,
      opts: { before: Date; batch?: number }
    ): Promise<number>;
    ```

  - Decisions:
    - Exact SQL of the migration:

      ```sql
      -- migrate:up
      CREATE INDEX outbox_email_idx ON outbox (email_id) WHERE email_id IS NOT NULL;
      CREATE INDEX outbox_digest_idx ON outbox (digest_id) WHERE digest_id IS NOT NULL;
      CREATE INDEX emails_org_created_idx ON emails (org_id, created_at);

      -- migrate:down
      DROP INDEX emails_org_created_idx;
      DROP INDEX outbox_digest_idx;
      DROP INDEX outbox_email_idx;
      ```

      Not `CONCURRENTLY` (dbmate runs a migration in a transaction; the pilot tables are small).

    - Rows and values: the A23 table rows of `mail` and `triage`, word for word. "Before" is strict: `created_at < before` (a row exactly at the limit stays).
    - `clearMailBodies` rule: `body_text IS NOT NULL AND created_at < before AND status <> 'processing' AND (status <> 'pending' OR created_at < pendingBefore)`. The caller passes `before = now − data_retention_days` and `pendingBefore = now − 7 d` (the triage `MAX_AGE_MS`: a `pending` mail stored more than 7 days ago is `too_old` at its next triage anyway). Why: a mail of a `paused` or `auth_error` mailbox, of a `suspended` organization, or under `TRIAGE_LLM_SCOPE=off` stays `pending`; its body must still go after its period (cold review finding 2).
    - `clearMailHeaders` rule: `created_at < before AND (subject IS NOT NULL OR from_address IS NOT NULL OR to_addresses <> '{}' OR cc_addresses <> '{}' OR in_reply_to IS NOT NULL OR references_header IS NOT NULL)` → `subject = NULL, from_address = NULL, to_addresses = '{}', cc_addresses = '{}', in_reply_to = NULL, references_header = NULL`. `message_id_header`, `dedup_key`, `thread_key`, `content_hash` stay (the sync dedups and locates mail by them; S6e names them in the papers, A23).
    - `clearTriageTexts` rule: `created_at < before AND (reason IS NOT NULL OR fields <> '{}'::jsonb)` → `reason = NULL, fields = '{}'`.
    - `requeueTooOld` guard: add `.where("body_text", "is not", null)`, so a backfill never triages a mail without text.
    - Batch shape: loop `UPDATE <table> SET … WHERE org_id = ${ctx.orgId} AND id IN (SELECT id FROM <table> WHERE org_id = ${ctx.orgId} AND <rule> ORDER BY id LIMIT ${batch} FOR UPDATE SKIP LOCKED)` until a batch changes 0 rows; sum the counts. A row that a job holds is skipped this time and cleared on a later day.
    - No trigger exists that sets `updated_at` (`grep -n TRIGGER db/migrations/*.sql` → none); the functions do not set it.

  - Test (`retention-clear.test.ts`, `withRollback`; `now = 2026-11-12T03:00:00Z`; each case seeds org A (the subject) and org B with the same rows; B's rows never change (tenant filter); "over" = the limit − 1 s, "at" = the limit):
    1. `clearMailBodies` (`before = now − 30 d`, `pendingBefore = now − 7 d`): A has a `done` mail over (→ null), a `done` mail at (kept), a `processing` mail over (kept), a `pending` mail over (→ null, it is older than `pendingBefore`), a `pending` mail with `created_at = now − 3 d` and `before` set to `now − 1 d` in a second call (kept: newer than `pendingBefore`) → the first call returns 2; a repeat returns 0.
    2. `clearMailBodies`: a `pending` mail over in a `paused` mailbox of A, and one in a suspended org C → both cleared (the function has no status or plan filter on the mailbox or the org).
    3. `clearMailHeaders` (`before = now − 90 d`): a mail over → `subject`, `from_address`, `in_reply_to`, `references_header` null, `to_addresses`, `cc_addresses` `{}`; `message_id_header`, `dedup_key`, `thread_key`, `content_hash`, `received_at`, `status` unchanged; at the limit kept; repeat → 0.
    4. `clearTriageTexts`: a result over → `reason` null, `fields` `{}`; `category`, `confidence`, `reason_code` unchanged; at kept; repeat → 0.
    5. Batch: `clearMailBodies` with `batch: 2` over 5 rows → returns 5.
    6. Migration: `select indexname from pg_indexes where indexname in ('outbox_email_idx','outbox_digest_idx','emails_org_created_idx')` → 3 rows.
    7. Requeue: a `skipped` / `too_old` mail in the window with `body_text` null → stays `skipped`; one with a body → re-queued (the existing behaviour).
  - Check: `bun run db:migrate` (worktree DB), `bun run db:types`, `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the checks pass.
  - Out of scope: the `actions`, `delegation` and `channels` functions (stage 13); the job (stage 14).
