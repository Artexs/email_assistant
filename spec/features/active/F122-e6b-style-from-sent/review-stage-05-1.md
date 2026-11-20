PASS de5c06dc8d00a16ed893a02b21ad671ac301ef74

The candidate is the drop of the old organization signature column (`organizations.style_text`), F122 stage 05. It has the stage commit `7ebf571c4` and a merge of master, `de5c06dc8`. `git rev-parse HEAD` returns `de5c06dc8d00a16ed893a02b21ad671ac301ef74`, which matches the commit I was given.

Blocking findings: none.

Unverified checks:
- I saw no `check:job` line from the worker and no GitHub CI result for this commit. The task said to run no suite, so I ran no lint, typecheck, unit, integration or e2e tests.
- I did not run `db:migrate` or `db:migrate:e2e` on a DB.
- I did not run the step 1 integration case (insert an organization, then export) or the privacy map tests.

Acceptance ("`organizations.style_text` is gone from the schema and the code; existing mailboxes keep the copied signature"):
- **Migration** (`db/migrations/20261120120001_drop_style_text.sql`), proven by reading the file and running the check script.
  - It has `-- contract: v0.4.4`, `SET LOCAL lock_timeout = '10s'` and `ALTER TABLE organizations DROP COLUMN style_text`. It copies nothing.
  - Its down part starts "Dev database only" and adds back an empty nullable column. This follows `docs/code-patterns.md` § Migrations ("The `-- migrate:down` part is for the dev database"). It is the same as the earlier column drop of the same release train (`20261120110001_drop_old_cursor_columns.sql`).
  - The column has no CHECK to drop. The tenancy migration created it as a plain `text`.
  - The timestamp is the newest in `db/migrations/`, and master has no migration next to it.
- **Contract check** (`bun run db:check-migrations`): proven.
  - At HEAD it exits 0. An earlier run printed `ok: 14 migration file(s) after 20261115160001`.
  - On a temp copy of the file without the `-- contract:` line (`--dir <tmp>`) it reports `…drop_style_text.sql:12 drop_column`, one contract statement. So the line is what makes the check pass.
- **v0.4.4 is live and already carries the copy and the stop-using change**: proven.
  - `v0.4.4` is `fb1df6d64` and is an ancestor of HEAD. Its tree holds `20261120100001_style_text_copy.sql`, and the stop-using commit `f86308103` is an ancestor of `v0.4.4`.
  - `git grep style_text v0.4.4 -- apps packages` finds the column only in the generated schema type, the two privacy map entries that exclude it, and tests. So the code of v0.4.4 runs on the new schema.
  - The one runtime read of `information_schema` in the privacy module (`erase.ts` `nullability`) only looks up the nullability of columns in the erase map. `style_text` is not in that map.
  - `notes/2026-11-15-vps-deploy-queue.md` § Release v0.4.4 records `release ok v0.4.4`, both migrations applied, and the 30-minute watch clean. The contract line names the right release: it stopped the use and it is the rollback target.
- **No reader or writer is left**: proven by `rg -n "style_text|styleText"`, which skipped `db/migrations`, `spec`, `notes`, `evals/results` and `.ai`.
  - `apps/` and `packages/` have one hit only: the allowed 400 test in `apps/server/test/integration/web-organization.test.ts:174`.
  - Elsewhere, only old product docs name the column: `docs/product/stage-2/*`. They are history and outside the scope list of the stage.
  - The column is gone from `platform/db/schema.ts`, the `NOT_PERSONAL` entry in `privacy/address-map.ts` and the export map (`organizations` is now plain `byOrg`). The patch summary is updated in `tenancy/api-docs.ts` and `docs/api/openapi.json`.
  - The capability pages tenancy-and-plans, web-panel, reply-drafts, drafts-and-send, live-lab and `docs/architecture.md` are updated.
  - Seeds, `deploy/` and the legal data categories in `packages/core` do not name the column.
  - The docs claim that `PATCH /api/organization` refuses any unknown key is true: `organizationPatchSchema` is a `z.strictObject` (`packages/core/src/web/organization.ts:7`).
- **Privacy export test**: the assertion of the exact key list of `organizations` stays, has no `style_text`, and has a new comment. Proven by reading `apps/server/test/integration/privacy-export.test.ts:306-318`; I did not run it.
- **Deleted tests**: they match the list in the stage, proven by reading the diff.
  - Case 13 of `reply-drafts-schema.test.ts` ("Down then Up gives each mailbox the style text as signature") wrote and read `style_text` directly.
  - Case 14 ("Down deletes the rows of the new kinds…; Up works again") re-ran the Up part of `20261117130001_reply_drafts.sql`, which reads `o.style_text` (line 78). So it cannot run after the drop.
  - `style-text-copy-migration.test.ts` is gone whole; it was the copy test of stage 04.
  - Every other case of `reply-drafts-schema.test.ts` stays, and its imports all still have uses. I found no other schema test that re-runs a migration that names the column: only three migrations name it.

Notes (none blocking):
- **No changelog line** (proven by reading `CHANGELOG.md`). `## [Unreleased]` is empty. The earlier column drop got a "Removed" item in `[0.4.4]`, and `release:prepare` refuses an empty `[Unreleased]`. The coordinator, or the release job, should add one Removed line for this drop before the next release.
- **No rollback note in `deploy/README.md`** (proven by reading it). The earlier column drop has a three-line note: roll back to v0.4.3 with `deploy/rollback.sh` alone; an older release needs a restore from the pre-migration backup. This drop has no such note. The comment in the migration says the same thing, so this is consistency only.
- **Stage proof** (unverified here): stage 05 asks for a check that the privacy map tests fail before the map edit, and for the Proof line with the full suites (a migration changed). Read both from the worker's final message.

Checks I ran:
- `git rev-parse HEAD`: matches.
- `bun run db:check-migrations`: exit 0, 14 files.
- The same script with `--dir` on a temp copy without the contract line: one `drop_column` finding at line 12.
- `rg` for `style_text|styleText` across the repo, as above.
- `git grep` and `git ls-tree` at `v0.4.4`.
- `git merge-base --is-ancestor` for `v0.4.4` against HEAD and for `f86308103` against `v0.4.4`: both true.
- Read-only inspection of the diff, the migrations, the privacy maps, the erase code at v0.4.4, `CHANGELOG.md`, `deploy/README.md` and the release checklist.

Note check
Job folder J = `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-20-f122-style-text-column-drop-re-r-a0429d66/`.
- HEAD matches, and the migration is a contract drop with a forward-only down part: proven. Evidence: `J/head.log`, and the chain `git rev-parse HEAD > $J/head.log && bun run db:check-migrations > $J/check-migrations.log 2>&1 && git merge-base --is-ancestor v0.4.4 HEAD && git cat-file -e v0.4.4:db/migrations/20261120100001_style_text_copy.sql && git merge-base --is-ancestor f86308103 v0.4.4 && git show 7ebf571c4 -- <the two test files> > $J/deleted-tests.diff && echo ok`, which exited 0. The down part I checked by reading `db/migrations/20261120120001_drop_style_text.sql`.
- No code, map, seed, privacy export or doc reads or writes the column: proven. Evidence: `J/rg-style-text.log`. Its only hits are the old product docs in `docs/product/stage-2/` and the allowed 400 test.
- Deleted tests only covered the column or the copy: proven. Evidence: `J/deleted-tests.diff`.
- v0.4.4 is live and carries the copy and the stop-using change: proven. Evidence: the same exit-0 chain (`git cat-file -e v0.4.4:db/migrations/20261120100001_style_text_copy.sql && git merge-base --is-ancestor f86308103 v0.4.4`), and `notes/2026-11-15-vps-deploy-queue.md` § Release v0.4.4.
- Easy-to-miss rule "Run no test suite": followed. I ran only `db:check-migrations` (a migration-file script, not a test suite), `rg` and git commands. I ran no `test:*` command, `check:job`, lint or typecheck.
- Reminder, tests run once per job and no `test:*` command: followed. None ran.
- Reminder, `check:job` as the last step of a job that commits product code: not applicable. This review committed nothing.
- Reminder, a review runs no suite, lint or typecheck: followed. None ran.
- Reminder, never delete `node_modules/.cache/`: followed. I deleted no folder except my own `mktemp` folder.
