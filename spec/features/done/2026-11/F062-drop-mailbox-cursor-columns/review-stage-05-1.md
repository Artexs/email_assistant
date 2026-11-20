PASS dd984f127cd695ef27a18c7735c18f78f132ed35

Reviewed commit: dd984f127cd695ef27a18c7735c18f78f132ed35. It is "F062 stage 05: contract migration drops the old mailbox cursor and renamed email columns". `git rev-parse HEAD` matches it. The worktree was clean.

I found no blocking finding.

Unverified (I ran no suite, as the task said):
- T3 is unverified. It is the missing-row round trip: `db:rollback`, then a mailbox with no INBOX row, then `db:migrate`. I did not run it.
- T2 and T5 are unverified. T2 is the privacy-export-map test and T5 is the guard test. The worker's `check:job` line and CI cover them.
- `schema.ts` against `db:types` is unverified by generation. I did not run `db:types`. The diff removes exactly the four fields (`emails.inbox_uid`, `emails.undo_pending_at`, `Mailboxes.last_uid`, `Mailboxes.uidvalidity`) and nothing else.

The one check that would prove this candidate wrong: build a DB with the HEAD migrations, then run the v0.4.3 tree's mail and actions integration tests against it (`git worktree add … v0.4.3`). A "column does not exist" error proves that the rollback target is broken.

Findings, all notes:

1. **The migration matches the contract (proven by reading the file and git).**
   - `db/migrations/20261120110001_drop_old_cursor_columns.sql` has `-- contract: v0.4.3`. Its timestamp 20261120110001 is later than 20261120100001.
   - Up runs the D6 INBOX backfill insert (`ON CONFLICT DO NOTHING`, no target, as the stage says). Then it drops the trigger and the function, then the two `emails` columns, then the two `mailboxes` columns.
   - Down adds the four nullable columns, copies the values back, and recreates the function and trigger. They are character-identical to `20261119140001_emails_neutral_names.sql`.
   - The tag is true. `git merge-base --is-ancestor` gives yes for v0.4.3 for stage 01 (1e0715292), stage 02 (477f939b3), stage 03 (ac34ba17c) and stage 04 (a4749fd2d, dac8d39d0).
   - `885e71043` records v0.4.3 as released on the VPS.

2. **There is one statement that the stage list does not name (proven, harmless).**
   - The migration has `SET LOCAL lock_timeout = '10s';`. The task's "no other statement" rule does not allow it strictly.
   - It copies the stage-01 pattern. It runs inside the dbmate transaction and changes no schema. I record it as a note, not as a break.

3. **No dropped column is named outside the allowed places (proven by rg at HEAD).**
   - `rg -w` for `inbox_uid`, `undo_pending_at`, `inboxUid`, `undoPendingAt`, `UndoPending` and `emails_copy_renamed_columns` over apps, packages, scripts, tools, docs and db finds only these:
     - the older migrations;
     - the guard test and its fixtures;
     - the reduced T4 schema test;
     - `probe-move.ts` and its test (local `inboxUid`, allowed by D9);
     - ADR 0014;
     - `docs/owner-decisions.md`.
   - A search for `mailboxes` cursor uses finds none: `mailboxes.uidvalidity`, `m.last_uid`, raw `sql` blocks that name `mailboxes` with `uidvalidity` or `last_uid`, and Kysely `insertInto`, `updateTable` or `selectFrom("mailboxes")` with those columns. The only hit is the T4 `information_schema` assertion.
   - No view or index names a dropped column. Only the add and drop migrations name them.

4. **The privacy export map, the DSR map and the allow list match the schema (proven by reading).**
   - `tables-e-m.ts` lists 18 exported `mailboxes` columns. They equal the `Mailboxes` interface in `schema.ts`. `emails` no longer has the two excluded entries.
   - `address-map.ts` has no dropped column.
   - `RETIRED_COLUMN_ALLOW` lost `schema.ts` and `tables-e-m.ts`. The fixture test now uses the T4 file, which stays allowed.
   - The stage file names `privacy/export-map.ts`, but the real file is `export-map/tables-e-m.ts`. This is a stale path in the stage doc only.

5. **v0.4.3 runs on the new schema, v0.4.2 does not (proven by `git grep`).**
   - In v0.4.3, outside tests, the names appear only in:
     - `schema.ts`, which is types only;
     - the export-map excluded entries;
     - `toMailboxRow`, which destructures `uidvalidity` and `last_uid` from a `selectAll` row. That gives undefined at runtime and causes no error;
     - `probe-move.ts`, as a local variable.
   - The v0.4.3 export (`export.ts`) and the demo seed select only `spec.columns`, so excluded columns are never read. `erase.ts` reads `information_schema` only to get nullability.
   - The v0.4.3 cursor readers (`sync.ts`, `sync-below-cursor.ts` via `lockSyncFolder`, `mailbox-settings-args.ts` via `SyncFolderRow`) read `mailbox_folders` rows.
   - v0.4.2 names `inbox_uid` and `undo_pending_at` in nine non-test files, for example `mail/repo/emails.ts`, `actions/repo/claims.ts` and `mail/sync-rules.ts`. v0.4.2 cannot run on the new schema.
   - The task asks that v0.4.2 run on the new schema. This conflicts with plan D10 and stage S05-1: only the contract release v0.4.3 can be reached by `deploy/rollback.sh`, and older targets need a backup restore. `deploy/README.md` and `CHANGELOG.md` state this.
   - This is task drift, not a candidate defect. The coordinator should confirm that a rollback to v0.4.2 needs a restore.

6. **The test helper change is correct (plausible improvement).**
   - `mail-history-backfill-helpers.ts` `cursorOf` now reads the `mailbox_folders` INBOX row with `executeTakeFirstOrThrow`.
   - Before, it read the stale `mailboxes` copy, which nothing has written since stage 02. The "cursor unchanged" asserts now check the live cursor.
   - A seed with no INBOX folder row would throw. CI covers this.

7. **ADR 0014 has stale lines (plausible doc drift, not in this diff).**
   - Lines 36 and 70 still describe `undo_pending_at` as the live move marker.
   - The new dated line 57 records the drop and the closed rollback window, which meets the ticket acceptance. A later docs touch could rename the two lines to `move_pending_at`.

Checks I ran:
- `git rev-parse HEAD` gave dd984f127…, which matches the candidate.
- `bun run db:check-migrations` gave `[check-migrations] ok: 13 migration file(s) after 20261115160001`. This is a static scan, not a suite. Its bash call piped the output through `tail`, so Limen will not count it as a proof.
- `git merge-base --is-ancestor` for the five F062 stage commits against v0.4.3 gave all yes. Against v0.4.2, only stage 02 gave yes.
- I ran `git grep` on v0.4.3 and v0.4.2 for the dropped names, and `rg` at HEAD as described above.

I ran no test suite, lint or typecheck.

Note check
- Migration shape (drops the trigger and four columns, down restores the shape, timestamp later than 20261120100001): proven. Evidence: `db/migrations/20261120110001_drop_old_cursor_columns.sql`.
- The `-- contract: v0.4.3` line is true (the tag holds stages 01–04): not proven by Limen's rule. My `git merge-base --is-ancestor` calls used `;` and `||`. The yes results are in the findings above, but no clean single command or saved log exists.
- No code, SQL, view, index or test names a dropped column: not proven by Limen's rule. The `rg` calls used pipes. The file-level evidence I read is `apps/server/src/platform/db/retired-columns.test.ts` and `apps/server/test/integration/emails-renamed-columns-schema.test.ts`.
- The export map and DSR map match the schema: proven. Evidence: `apps/server/src/modules/privacy/export-map/tables-e-m.ts` against `apps/server/src/platform/db/schema.ts` (`Mailboxes`, 18 columns), and `apps/server/src/modules/privacy/address-map.ts`.
- The `RETIRED_COLUMN_ALLOW` list is shorter: proven. Evidence: `apps/server/src/platform/db/retired-columns.test.ts`.
- `schema.ts` matches the new schema: changed. I checked it by reading `apps/server/src/platform/db/schema.ts` (the four fields are gone). I did not run `db:types` generation, because the task said "Run no suite" and it needs a migrated DB.
- v0.4.3 and v0.4.2 run on the new schema: changed. v0.4.3 holds, but my `git grep` calls used pipes or `;`, so this is not proven by Limen's rule. v0.4.2 does not hold, and plan D10 and stage S05-1 accept that. The scope narrowed to the contract release.
- T3 (missing-row round trip): not proven. I did not run it, because the task said "Run no suite".
- Easy-to-miss rule "Run no suite": followed. My only non-git command was `bun run db:check-migrations`, a static scan. I ran no test, lint or typecheck command.
- Reminder "Tests run once per job; do not run test:unit/int/e2e": followed. I ran none.
- Reminder "Commit jobs run check:job last": not applicable, and followed. This is a review job, and I made no commit.
- Reminder "A review job runs no test suite, lint or typecheck": followed. I ran none.
- Reminder "Never delete node_modules/.cache": followed. I did not touch it.
