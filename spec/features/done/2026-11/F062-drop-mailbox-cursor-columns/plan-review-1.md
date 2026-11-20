FAIL 791e2bf58f603e82068b753debc93ab184ea75af

The order of the two migrations is sound. The trigger rule works, and the migration check accepts and rejects the right files. One contradiction in the plan is proven, and it breaks the guard test as written. Fix it before stage 04 runs.

## Blocking

**1. The guard test, the ticket acceptance and the stage-01 test file contradict each other (proven, by reading).**
- The ticket says that after stage 04 the guard finds the old names nowhere outside migrations and `schema.ts` (`ticket.md:29`). Plan line 100 says the same.
- Stage 01 must keep the old names in two files under `apps/`:
  - `export-map.ts`: the old columns stay as excluded entries (`stage-01:28`). The `privacy-export-map` test needs every column listed (`privacy-export-map.test.ts:51-57`).
  - `apps/server/test/integration/emails-renamed-columns-schema.test.ts`: T1, T3, T5, T7 and T8 must insert and update by `inbox_uid` / `undo_pending_at` (`stage-01:32-41`).
- The stage-04 allow list names `schema.ts`, `export-map.ts`, the guard and the probe tool, but not the stage-01 test file (`stage-04:18`). The guard reads all `.ts` under `apps/` and does not skip quoted strings (`stage-04:16-17`). So T2 "run on the repo → no finding" (`stage-04:38`) fails at stage 04.
- The same clash returns in stage 05. The reduced T4 test still names the old columns in an `information_schema` check (`stage-05:44`), and T5 needs the guard to pass with the shorter list (`stage-05:45`).
- Fix: add the stage-01 test file to `RETIRED_COLUMN_ALLOW` in stages 04 and 05. Reword `ticket.md:29` and `plan.md:100` to name the real allow list.

## Unverified

- Real job DB, `bun run test:*`, lint and typecheck: not run. This worktree has no `.env` or job DB, and a plan review does not need them.
- Two facts are not checked against the VPS: that every live mailbox has an INBOX folder row, and the `emails` row count. The plan already lists both as not verified (`plan.md:90-91`).

## Notes

**2. A rolled-back expand release can block every fix (plausible).**
- Once stage 05 is on master, every release cut from master carries the contract migration.
- Suppose the expand release is rolled back for a bug. Stage 05 then says to wait "until it is deployed again" (`stage-05:36`, `plan.md:78`).
- But the checklist says to fix forward in a new patch release (`docs/release-checklist.md:24`). That release would drop columns that the rollback target still uses.
- No rule covers this case. Two options: start stage 05 only after the expand release has run for a set time, or revert stage 05 on master.

**3. Stage 05's version check cannot pass as written (proven, by reading).** S05-4 tells the worker to stop when stages 01–04 are not all in the release's `CHANGELOG.md` section (`stage-05:37`). Only stage 01 writes a changelog line (`stage-01:29`). Stages 02, 03 and 04 say "Changelog. None" (`stage-02:27`, `stage-03:30`, `stage-04:32`). A worker will stop or guess. Check `deploy/release-state/state` or the tag contents instead.

**4. "The named release, or a later one" conflicts with the checklist (proven, by reading).**
- S05-2 accepts that `current` is "the release in the `-- contract:` line or a later one" (`stage-05:36`). It calls this the existing rule.
- The checklist says the named release "must be the release that you can roll back to" (`docs/release-checklist.md:26`).
- If another release ships between the expand release and the contract, the two texts give different answers.
- The VPS has skipped a release before: v0.4.1 went out with v0.3.1 as previous (`notes/2026-11-15-vps-deploy-queue.md:96`). So this can happen.
- Pick one rule. Simplest: the contract line names whatever `current` is when the contract release deploys.

**5. The demo seed format changes too, and no rule covers it (proven, by reading).**
- The demo seed takes its columns from `EXPORT_MAP` (`lab/demo-seed/tables.ts:3-6`).
- On import, `checkDemoSeed` refuses a row whose keys are not exactly those columns (`lab/demo-seed/format.ts:47-52`).
- After stages 01 and 02, a seed exported by an older release fails `lab demo-import` with `bad_seed`. Its keys are `inbox_uid`, `undo_pending_at`, `uidvalidity` and `last_uid`.
- D8 and Q1 cover only `org:export` (`plan.md:67`, `questions.md:1`). Add a decision (accept, or bump `ea-demo-seed/1`) and a line in `docs/capabilities/live-lab.md`.

**6. Merging master does not migrate the job DB (plausible).**
- `scripts/limen-prepare.sh` migrates the job DB only at spawn (`db-worktree.ts:97-174`).
- The plan says "merge master before the proof" (`plan.md:99`) and migrates only the shared dev DB (`plan.md:112`).
- Stage 02 runs next to stage 01. If it merges master after stage 01 lands, the stage-01 trigger test fails on its DB unless the worker runs `bun run db:migrate`. Other tickets' jobs hit the same problem when stage 01 or stage 05 lands.
- Add "after a merge that brings a migration, run `bun run db:migrate`" to the plan rules.

**7. The conflict target of the INBOX row insert is narrower than the runbook's (plausible, low).**
- Stage 05 uses `ON CONFLICT (mailbox_id, key) DO NOTHING` (`stage-05:17`).
- `mailbox_folders` also has `UNIQUE (mailbox_id, path)` (`db/migrations/20261109083501_sync_folders.sql:16`). A row with path `INBOX` under another key would fail the whole migration during the release.
- The runbook insert it claims to copy uses a plain `on conflict do nothing` (`deploy/README.md:492`).
- Also, stage 02 rewrites that README bullet (`stage-02:19`). Stage 05 then points to text that may be gone. Put the column list in stage 05 itself.

**8. Smaller gaps (plausible).**
- **Stage 01 gate:** "stage 01 rides the release after v0.4.2" (`ticket.md:40`) is not in stage 01's Needs line or in How to run (`plan.md:131`). Today's latest tag is v0.4.1, so stage 01 could land early and ride v0.4.2. That release works too, but it breaks the release plan in the notes.
- **Lock wait:** the expand `ALTER TABLE` has no `lock_timeout` (`stage-01:27`). It runs while the old release is live. A long transaction on `emails` makes it wait, and every query on `emails` queues behind it.
- **Older tags:** `deploy/release.sh` accepts any tag that is not `current` (`release.sh:51`). After the contract, a manual `release.sh` of an older tag starts code that uses dropped columns. D10 covers only `rollback.sh`.
- **Dangling section:** S05-1 cites `deploy/README.md` § Backups (`stage-05:35`). No heading with that name exists. The bad link already existed (`deploy/README.md:66`).

**9. Checked and sound (proven).**
- **Schema states:**
  - Expand migration: the old release writes only the old names, and the trigger fills the new ones. The new release writes only the new names. A rollback goes one release back with no migration step (`rollback.sh:3,33-53`).
  - Contract migration: its rollback target, the expand release, names no old column. The guard enforces this until the CI run on the tag, and the export selects only the columns it lists (`privacy/export.ts:59`).
  - Release order: the migration runs before the code switch (`release.sh:97-101`). The plan accounts for this.
- **RLS:** the `migrator` role bypasses row-level security (no FORCE, `rls_tenant_policies.sql:3`). So the expand `UPDATE` and the contract `INSERT` are not silently filtered.
- **Trigger rights:** the trigger runs as the caller, and the `app` role already holds table rights (`app_grants.sql:2`).
- **Old mailbox cursor (D5):** the VPS has run tagged releases since v0.1.0. The sort-folder migration (2026-11-09) is older than v0.1.0, so no rollback target reads the `mailboxes` cursor.

## Checks run

- **Candidate:** `git rev-parse HEAD` → `791e2bf58f603e82068b753debc93ab184ea75af`. This matches the candidate. Output saved in `/tmp/f062rev/head.log`.
- **Migration check:** I wrote both migrations as the plan describes them and passed them to the `db:check-migrations` rules (`checkMigrationSql`). Output saved in `/tmp/f062rev/check-migrations.log`:
  - Expand: no findings. ADD COLUMN, UPDATE, the plpgsql trigger function and CREATE TRIGGER all pass, and the name "renamed" does not trigger the `RENAME` rule.
  - Contract without the `-- contract:` line: 6 findings (drop_trigger, drop_function, 4 × drop_column).
  - Contract with `-- contract: v0.4.3`: no findings.
- **Trigger rule D3:** I applied the expand migration to a minimal `emails` table in a throwaway local `postgres:17` container (`/tmp/f062rev/t.sql`). Output saved in `/tmp/f062rev/trigger.log`. The backfill copied both values, and every T1–T9 expectation held:
  - writes through the old names reach the new names, and the reverse;
  - null clears go both ways;
  - an update of `status` alone leaves the pair as it was;
  - when both names change, the new name wins (insert 5/6 → 5; update 9/10 → 9);
  - an insert with all four values null stays null.

  Not covered: the real `emails` table, its RLS, and the tombstone trigger that runs next to the new one.

## Note check

- HEAD is the candidate: proven. `/tmp/f062rev/head.log` holds `791e2bf58f603e82068b753debc93ab184ea75af`.
- Each finding quotes file and line, with a proven/plausible/unverified label: proven. `/tmp/f062rev/review.md` lists each finding with its file:line and label; this message has the full text.
- The order is checked against `release.sh`, `rollback.sh`, code-patterns § Migrations, rule D3, both schema states and the `db:check-migrations` rules: proven. Evidence: `/tmp/f062rev/check-migrations.log`, `/tmp/f062rev/trigger.log`, and note 9 with file:line citations. Gap: the trigger was tested only on a minimal table, not on the real `emails` schema.
- Easy-to-miss rule ("missing code detail is not a finding"): followed. Each finding in `/tmp/f062rev/review.md` names a contradiction, a missing decision, a missing edge case or a missing step. None asks only for line numbers, edit text or lists of files.
