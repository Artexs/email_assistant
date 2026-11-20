# Scouts · F062

Four scouts (claude-sonnet-5-5, medium) at base 96cf823f, 2026-11-19. Packets copied whole from each job's last report.

## Scout 1

Question: Where does the code read and write mailboxes.uidvalidity and mailboxes.last_uid (the old INBOX cursor and its dual write from mailbox_folders)? List every reader and writer outside tests, say which reads still depend on them, and whether mailbox_folders alone already holds the INBOX cursor for every mailbox.

Job: `2026-11-19-f062-scout-1-01da80f6`

Packet: Which code reads or writes `mailboxes.uidvalidity` and `mailboxes.last_uid`, and does `mailbox_folders` alone hold the INBOX cursor for every mailbox?
Base: 96cf823f
Verified: `rg -n "uidvalidity|last_uid" apps/server/src/modules/mail/repo/folders.ts ...` -> `folders.ts:215:        .set({ uidvalidity: next.uidValidity, last_uid: next.lastUid })`
Unknowns: Production data. I did not check that every live mailbox has an INBOX folder row. Only the migration and the creation code paths support that.

1. Only two non-test code paths write the columns, and both are in `apps/server/src/modules/mail/repo/folders.ts`. Observed.
   - `updateFolderCursor` (lines ~203-218) copies the cursor to `mailboxes` when `row.key === "inbox"`.
   - `forceRescan` (lines ~241-253) sets `mailboxes.uidvalidity = "0"`, marked "A dual write".
2. The only non-test reader of the columns is `getMailbox`. Observed.
   - `getMailbox` (`mailboxes.ts:~96`) does `selectAll`, and `toMailboxRow` (`mailboxes.ts:~49-50`) maps them to `MailboxRow.uidvalidity` and `MailboxRow.last_uid`.
   - I found no consumer of those two fields on a `MailboxRow`. The `rg` hits in sync, sync-backfill, sync-chunk, sync-below-cursor and moves all read `SyncFolderRow` (`folder.`, `row.`, `locked.`). `mailbox-settings-args.ts:166` also reads a `SyncFolderRow`. Hits in `sent-state.ts` and `sent-emails.ts` use other tables (`mailbox_sent_sync`, sent emails). Hits in `trust/*` are the `uidvalidity` reason name, not the column.
   - `insertMailbox` does not set the columns, so new rows start NULL.
   - Other places that touch the columns: `platform/db/schema.ts` (generated types) and the `mailboxes` entry in `privacy/export-map.ts` (lines ~214-227 and ~264; I did not check which table each block maps). I found no hits in operator, health or `deploy/` code, and none under `scripts/`. `deploy/README.md` only mentions them in the rollback text.
   - Tests that touch them: `apps/server/test/integration/mail-sync.test.ts:169-183` ("dual write") and fixtures such as `mailbox-rows.ts` and `fixtures.ts`. I did not read these. They will need updating.
3. `mailbox_folders` holds the INBOX cursor for every mailbox that exists, by construction. Observed.
   - Migration `db/migrations/20261109083501_sync_folders.sql` has `INSERT INTO mailbox_folders ... SELECT ... 'inbox','INBOX','inbox', uidvalidity, last_uid FROM mailboxes`. It gives every existing mailbox an INBOX row with its cursor copied.
   - After that, every creation path inserts the INBOX row with `insertInboxFolder`: `connect.ts:215`, `oauth/apply.ts:237`, and the e2e seeds.
   - `sync.ts:159` and `sync.ts:183` throw "mailbox has no INBOX folder row", so sync needs the row and a mailbox without one cannot sync.
   - `updateCursor` returns false when there is no INBOX row.
   - The table has `CHECK (role <> 'inbox' OR (path='INBOX' AND enabled))` and `UNIQUE (mailbox_id, key)`.
   - The risk is the other direction: a mailbox created after the migration, outside these paths, would have no INBOX row. I found no such path. The risk is therefore small, but not tested against real data.
4. The dual write runs one way only: folder row to `mailboxes`. So the old columns can only be stale or equal, never newer. Dropping them loses no cursor. Observed.

Checks: `apps/server/test/integration/mail-sync.test.ts:169` ("after an incremental sync mailboxes.last_uid equals the INBOX folder row (dual write)") covers the dual write; it would need to be deleted or changed. I did not run any test. Nothing covers "every mailbox has an INBOX row" against production data.

## Scout 2

Question: What does emails.inbox_uid mean and who reads and writes it? Check whether the name appears in stored JSON, an HTTP response or a web schema, so that a column rename would also need a data or API change.

Job: `2026-11-19-f062-scout-2-9593cce9`

Packet: What does emails.inbox_uid mean, who reads and writes it outside tests, and does the name appear in stored JSON, HTTP or web schemas?
Base: 96cf823f
Verified: `grep -rniE "inbox_?uid" apps packages tools scripts evals` -> `apps/server/src/modules/mail/repo/emails.ts:53:    .set(opts.isSource === false ? { uid } : { uid, inbox_uid: uid })`
Unknowns: I did not run the DB or the `org:export` command. I read only the `export-map.ts` column list. I did not check whether a deployed dataset (fixtures outside the repo, production llm.call rows) has the name. In the repo, nothing outside server code and the docs has it.

1. **Meaning** (observed). `emails.inbox_uid` is the last known UID of the mail in `emails.source_folder`. `uid` is the UID in `folder`. The two differ only while the system has moved the mail (`folder <> source_folder`). The name is old: it dates from before the sort-folder sync. The migration `db/migrations/20261107000001_assist_actions.sql:7` adds it as a nullable bigint and back-fills it with `uid` for INBOX rows. The column type is `Int8 | null` at `platform/db/schema.ts:276`.
2. **Writers** (observed).
   - **mail**: `mail/repo/emails.ts` writes it at lines 37 (insert, `inbox_uid: row.uid`), 53 (uid update, only when the row sits in its source folder), 72 and 91 (return and move-change, set to the new uid), and 220 (the `sourceUid` option of the update at line 213).
   - **actions committer**: `actions/apply.ts:223` and `:312` pass `sourceUid` into that mail repo update. They never write the column directly.
3. **Readers** (observed).
   - **actions**: `actions/repo/claims.ts:253` selects `emails.inbox_uid`, and line 294 maps it into a claim row type (`:38`). `actions/apply.ts:275` reads `email.inbox_uid` as the `toUid` hint of an undo move. This feeds `locateMessage`. `locateMessage` has no direct reference; it gets the value only as a hint.
   - **mail sync**: `mail/repo/copies.ts:58-105` (`listRecentlyMoved`, filters `inbox_uid IS NOT NULL`, returns it in `MovedRow`). `mail/sync-below-cursor.ts:82` and `mail/sync-rules.ts:217-246` match moved rows by it.
   - **privacy**: `privacy/export-map.ts:168` lists it as an exported `emails` column.
   - **mail/imap/probe-move.ts**: its `inboxUid` is a separate local variable and report field (`moveBack.inboxUid`). It is not the column.
4. **Modules with no reference** (observed, grep). `triage`, `delegation`, `reports`, `operator`, `apps/web`, `packages/core`, `tools/`, `evals/` and `scripts/` have no match. So no `@ea/core` schema, web schema or route response carries the name.
5. **Does a rename need a data or API change?** (observed, partly guessed).
   - The `org:export` file is the one output that carries the column name. `export-map.ts` writes columns per table, and the test `privacy-export-map` compares the keys with `information_schema`. A rename needs a change to this map and a note that exports differ in key name. A guess: a consumer of old export files would see the key change.
   - No match in the code for `actions.payload`, `audit_log` details, outbox views or `llm.call` writers. Docs mention it: `docs/architecture.md:298` and `:370`, `docs/capabilities/actions-and-undo.md:124`, `docs/decisions/0014-sync-provider-sort-folders.md`, `docs/modules.md`.

Checks: `privacy-export-map` (the test file in `apps/server/test/integration/`) covers the column list against `information_schema`; it misses any consumer of old export files. The integration tests (actions-apply, actions-committer, actions-move, actions-undo, mail-moves, mail-repo, mail-sync, mail-history-backfill, scope-two-orgs, `fixtures.ts`, `trust-history-classify-helpers.ts`, and the unit test `mail/sync-rules.test.ts`) use the name and would need edits on a rename. I ran none of them.

## Scout 3

Question: What does emails.undo_pending_at mean and who reads and writes it? List every DB object that names emails.inbox_uid, emails.undo_pending_at, mailboxes.uidvalidity or mailboxes.last_uid.

Job: `2026-11-19-f062-scout-3-89d2b101`

Packet: What `emails.undo_pending_at` means, who reads and writes it, and which DB objects name the four columns.
Base: 96cf823f
Verified: `rg -n "inbox_uid|undo_pending_at|uidvalidity|last_uid" db/migrations` -> `db/migrations/20261107000002_undo_pending.sql:2:ALTER TABLE emails ADD COLUMN undo_pending_at timestamptz;`
Unknowns:
- `db/schema.sql` does not exist at HEAD (`ls db` shows `migrations`, `roles.sql`). The only schema source is the migrations plus the generated `apps/server/src/platform/db/schema.ts`. I did not read `schema.ts`.
- I did not read the RLS policy bodies in `20261114100002_rls_tenant_policies.sql` line by line. The grep on the four names found nothing there, so no policy names these columns. RLS is by `org_id`.
- Two tables in `20261115090001_sent_mail.sql` (see item 5) also have columns named `uidvalidity` and `last_uid`. They are not `mailboxes`.

1. **Meaning of `emails.undo_pending_at`** — A nullable timestamp. It marks that a system move of the mail into a synced folder is in flight (Undo or the rescue move). The sync stores no copy of the mail while the stamp is younger than 24 h (`MOVE_PENDING_MAX_AGE_MS`). Source: `docs/architecture.md:298`, `docs/capabilities/sync.md:29`. The column name is old. — observed
2. **Writers of `undo_pending_at`** — `setUndoPending` (`apps/server/src/modules/mail/repo/emails.ts:130`) sets it or clears it. Its callers are `actions/undo.ts:69` (sets it to `opts.now`, only for a reverse `move`), `actions/apply.ts:272` (sets it for the rescue move), and `actions/apply.ts:45` (clears it in a failure path). `updateEmailLocation` (`mail/repo/emails.ts:222`) clears it to null when `undoPendingAt: null` is passed. `actions/apply.ts:313` passes that on a finished reverse move or rescue. Nothing else writes it. Sync never writes it. — observed
3. **Readers of `undo_pending_at`** — `mail/repo/copies.ts:23,39` maps it to `movePendingAt`. `mail/repo/copies.ts:150` selects it for the move-candidate query. `mail/moves.ts:62` skips a row whose marker is younger than 24 h. `mail/sync-rules.ts:60` declares it in a row type. `privacy/export-map.ts:170` lists it as an exported column. Sync reads it through these files. The committer and undo only write it. — observed
4. **`inbox_uid` readers and writers (companion to item 5)** — These are in `mail/repo/emails.ts` (lines 37, 53, 72, 91, 220 write it), `mail/repo/copies.ts:58-105` (reads it), `mail/sync-rules.ts:233,246`, `mail/sync-below-cursor.ts:82`, `actions/repo/claims.ts:253,294`, `actions/apply.ts:275`, and `privacy/export-map.ts:168`. The meaning is the last known UID in `source_folder`. — observed
5. **DB objects naming the four columns (all in `db/migrations`)** — observed
   - `emails.inbox_uid`: only the add (`20261107000001_assist_actions.sql:7`), a backfill UPDATE (line 9) and the down-drop (line 29). It has no index, CHECK, trigger, view or policy.
   - `emails.undo_pending_at`: only add and drop in `20261107000002_undo_pending.sql`. It has no index, CHECK, trigger, view or policy. The partial indexes on `emails` (`emails_moved_idx`, `emails_returned_idx`, `emails_claim_idx`) use `moved_at`, `source_folder`, `returned_at`, `status`, not these two columns.
   - `mailboxes.uidvalidity` and `mailboxes.last_uid`: created in `20261103100001_mail.sql:12-13` with no CHECK or index. `20261109083501_sync_folders.sql:23-24` copies them into `mailbox_folders` (an INSERT … SELECT). No migration drops them. The functions `delete_mailbox` and `delete_organization` and the trigger `emails_skip_tombstoned` do not name them.
   - Same names on other tables, not `mailboxes`: `mailbox_folders.uidvalidity` and `last_uid` (`20261109083501_sync_folders.sql:10-11`). `sent_emails.uidvalidity` (`20261115090001_sent_mail.sql:9`). `mailbox_sent_sync.uidvalidity` and `last_uid` (lines 53-54), with CHECKs `mailbox_sent_sync_cursor_check` (line 62) and `mailbox_sent_sync_off_check` (line 65). The trust-report reason `'uidvalidity'` in `no_result_reason` CHECKs (`20261115180001_trust_ladder.sql:21`, `20261117120001_history_model_failing.sql:7,14`) is a string value, not a column.
   - Code that reads `mailboxes.uidvalidity` and `last_uid`: `mail/repo/mailboxes.ts` (a mapper that sets `uidvalidity` and `last_uid`, lines 205-216 at the read) and `privacy/export-map.ts:264`. I did not find a write to the `mailboxes` columns. The live cursor writes go to `mailbox_folders` (`mail/repo/folders.ts:173,204,215,241`).

Checks: `rg` over `db/migrations`, `apps`, `packages` covers all names found above; it misses anything built from dynamic SQL strings and the generated `schema.ts`. `git status --porcelain` is empty, so the worktree is clean.

## Scout 4

Question: How does a release and a rollback run (migration order, down migration, rollback depth)? Do Kysely queries on emails and mailboxes use explicit column lists, so that old code fails or works against a schema with extra or renamed columns?

Job: `2026-11-19-f062-scout-4-9a7b243c`

Packet: How release and rollback run, when migrations run, rollback depth, and whether Kysely column use breaks old code on a changed schema (F062).
Base: 96cf823f
Verified: `git status --porcelain | wc -l` -> `0`. I read `deploy/release.sh`, `deploy/rollback.sh`, `docs/code-patterns.md` § Migrations and the `mail/repo` files. I did not run a release or a rollback.
Unknowns:
- Nothing runs a rollback target (old code) against the new schema in CI. The only guard is the contract-line check `bun run db:check-migrations`, which I did not run. The "previous code must still read and write" rule is human review only.
- I did not read the two `mailboxes` selects in `claims.ts` or `folders.ts`, and not every one of the 53 `selectFrom("mailboxes"|"emails")` call sites. Only the `selectAll` sites in `mail/repo` were read.
- Insert audit: `NewEmail` has `Omit<Insertable<DB["emails"]>,…>`. I did not check whether other modules insert into `emails` or `mailboxes`. A grep for `insertInto("emails")` found `mail/repo/emails.ts:36` only. `mailboxes` has `mail/repo/mailboxes.ts:76` only.

1. `deploy/release.sh:74-101` — Order is: write state `pending`, tag the running image as `ea-server:<current>`, check out the tag, build once with `EA_RELEASE`, run `db:migrate`, then `up -d --no-build --wait`. Migrations run BEFORE the code switch, so the old code runs on the new schema until the switch finishes. A backup (`deploy/backup.sh`) runs first. — observed
2. `deploy/rollback.sh:3,33-53` — Rollback starts the old image with `up -d --no-build --wait`. It has no migration step and never runs `db:rollback`. The `-- migrate:down` part is for dev databases only (`docs/code-patterns.md:224`; `deploy/README.md:66`). Target is `current` when a release is pending, else `previous`. — observed
3. `deploy/release.sh:123-128` and `deploy/README.md:61` — Rollback goes exactly one release back. The state file holds only `current` and `previous`, and old images are pruned except those two. A second `rollback.sh` swaps forward again. A "previous" release has no older target. — observed
4. `deploy/README.md:490` and `docs/code-patterns.md:225-227` — The old cursor columns `mailboxes.uidvalidity` and `last_uid` stay as a dual write. The reason: a code rollback to the pre-F058 release must run on the new schema. A drop or rename needs `-- contract: v<x.y.z>` naming a release already deployed that stopped the use, and that release must be the rollback target (`docs/release-checklist.md:26`). — observed
5. Kysely column use:
   - `mailboxes`: `getMailbox` and `lockMailbox` use `selectAll()` (`mail/repo/mailboxes.ts:96,137`). `MailboxRow` is `Omit<Selectable<DB["mailboxes"]>,…>` and `toMailboxRow` spreads the whole row (`mailboxes.ts:44`). `insertMailbox` (`:76`) lists columns explicitly.
   - `emails`: `insertEmail` (`emails.ts:36`) inserts `{ ...row, inbox_uid: row.uid, org_id }`. It names `inbox_uid` explicitly and relies on the `NewEmail` shape (from `Insertable<DB["emails"]>`). Updates name columns (`inbox_uid` at `emails.ts:53,72,91,220`).
   - Effect: `selectAll` and spread tolerate extra columns in old code (extra fields ride along). A renamed or dropped column breaks the type at build time and, at runtime, any explicit use of the old name (`uidvalidity`, `last_uid`, `inbox_uid` are named in `mailboxes.ts` and `emails.ts`). An old release reading a schema where those are dropped or renamed would get `undefined` or a SQL error on the explicit uses. A new NOT NULL column with no default would fail old `insertEmail` and `insertMailbox` inserts. — observed

Checks: `bun run db:check-migrations` covers drop, rename, `SET NOT NULL` and similar statements in migrations newer than `CONTRACT_CHECK_AFTER` (`docs/code-patterns.md:227`); misses a narrowed CHECK list, a new NOT NULL column with no default, and any runtime run of old code on the new schema.
