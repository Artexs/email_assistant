# F116 stage 07 review (Opus 5.5, FAIL b77b1062, repaired)

Model: Opus 5.5, because the stage is [risky]: a migration and the privacy registries (mail-derived data).

BLOCKING B1 (repaired in a Sonnet continue, narrow re-review follows): the erase deleted a Sent mail as the person's own data but the loop kept a copy of its `subject` (probe P4). Decision: `clearLoopTextsOfPerson` sets `subject = null` with `text` for every loop that names the person in `counterpart`, `to_addresses` or `cc_addresses`.

Verified: the migration only adds (no DROP, type change or rename in Up; PG 17 `ADD COLUMN ... NOT NULL DEFAULT <const>` is metadata only); migrate, rollback, migrate is clean (the two Up schema dumps differ only in pg_dump tokens; Down drops only new objects); old code works on the new schema; composite FKs with `org_id`, `SET NULL (col)` on the Sent ids and `closed_by_email_id`; RLS and the `tenant_rows` policy; flags `open_loops` and `delegate_button` off (`LAB_FLAGS_OFF`); probes P1 (a Cc-only person), P2 (case differences), P3 (a loop closed by the person's reply) and P5 (a delegate with a loop cannot be deleted; no code deletes delegates; an org delete cascades) pass; 67 of 68 worker mutations killed (m05 equivalent).

Notes for stage 08 and F115:
- TG1: the org filter in `clearLoopTextsOfPerson` is covered only by RLS (the reviewer's mutation survives; equivalent while RLS is on).
- Retention: stage 07 needs none (no writer until stage 08). Stage 08 Step 2 `clearLoopTexts` is called from `apps/server/src/retention.ts` (F104's Sent text retention is `clearSentBodies` and `clearSentHeaders` in `modules/mail/repo/retention.ts`). Plan point for stage 08: only closed loops are cleared, so an open loop keeps its subject copy after the Sent subject clears at 90 days: decide.
- N3 (index name): F115 stage 03 now uses `CREATE INDEX IF NOT EXISTS emails_thread_received_idx` (G16 aligned), but each Down still drops the index the other feature relies on. F115 stage 03 should create no index and drop none and name F116's migration as the owner, or its Down must not drop it. `IF NOT EXISTS` checks only the name.
- The index on `emails` is not CONCURRENTLY: it holds a SHARE lock for the build time inside dbmate's transaction: fine at pilot size; for a large install use a `transaction:false` migration.
- `closed_by_user_id` has no index: a user delete scans `open_loops` (small).
- loops-schema test 1 runs Down and Up DDL in a rolled-back transaction on the shared test DB: it locks `emails`, `delegations` and `mailbox_settings` while it runs (plausible wait for parallel int tests; the full run passed).
