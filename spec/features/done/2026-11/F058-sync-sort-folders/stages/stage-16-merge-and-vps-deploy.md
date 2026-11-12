# sync-sort-folders — Stage 16

Part of [`../plan.md`](../plan.md). Read that file's U4, F4, F5, F11, D3, D17, D20, D22, D24 and "Rules for every step" first. Needs
stages 1–15 and user checkpoint 2.

## Stage 16 — Merge into `master` and VPS deploy [risky]

Why risky: it changes the live server on the user's only real mailbox during the S3 and S4 pilot weeks. Who: the main session.
Gate: user checkpoint 2 (the group review of stages 12–15 and the branch is PASS, the stage 14 dev run passed; the user says "deploy").

- [x] **16.1 Pilot-week notes, merge, deploy, first checks**
  - Goal: `master` holds the reviewed branch, the VPS runs it with the migration applied, and both pilot-week tasks know the change and its time (U4, done-when 7).
  - Files: `spec/features/planned/F037-s3-assist-week-result/plan.md` and `spec/features/planned/F047-s4-pilot-week/plan.md` (a section "Sort-folder sync (<deploy UTC time>)"); this task file
    (§ Results "Stage 16", Log).
  - Interfaces: none (operations). `C="docker compose -f deploy/compose.yaml --env-file .env"` in `~/email_assistant` on `ssh home_vm`; never print `.env`.
    Pilot ids: `<ORG>` = `ac6ed6a2-ee37-461f-9632-cc08cf549e40`, `<MB>` = `8bc7f572-a7f5-4fa5-aaab-db16dc663e96`.
  - Decisions:
    - The note text (S3): "From <T> the server also syncs `Oferty`, `Społeczności`, `Rachunki` and `Wiadomości-śmieci` (`spec/features/done/2026-11/F058-sync-sort-folders/plan.md`).
      Their mail can get moves into `AI/*` (and spam folder mail into INBOX). Report N (wrong moves) twice: for all real mail, and with
      `and e.source_folder = 'INBOX'` in every `emails e` join (the mail that the week started with). Spam folder mail with a `spam` result has no action."
      (S4): the same first two sentences, then "Count drafts, approvals and sends for all mail and with `e.source_folder = 'INBOX'`."
    - Merge as in `test-mail-traffic` checkpoint 1: in the branch `git merge origin/master` (then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
      pass); in a temporary detached worktree of `origin/master` (the main checkout holds other sessions' work): `git merge --no-ff task/sync-sort-folders`,
      push `master`; remove the temporary worktree.
    - D22: before the merge, `git log origin/master --oneline -- db/migrations`. A new S5a migration that sorts **after** ours: fine (the merged checks cover
      it; the deploy applies both: tell the user before step 6). One that sorts **before** ours and is not on the VPS: stop and ask the user.
  - Steps: 1. Merge and push (Decisions). Commit the two notes with `<T>` = `TBD` (they go with the merge, so the week tasks see the change at once). 2. Read-only pre-checks on the VPS: `git log -1 --oneline` (expect `fa60c7b` or the last deployed commit; write it as `<PREV>`);
    `$C exec -T db psql -U postgres -d email_assistant -c "select max(version) from schema_migrations"` → `20261108000001`; `grep -c '^ACTIONS_SCOPE=all' .env`,
    `grep -c '^SEND_SCOPE=all' .env`, `grep -c '^TRIAGE_LLM_SCOPE=all' .env` → 1 each; `df -h /` free > 2 GB; `$C logs --since 10m server | grep -cE 'failed|tries again|not on the server|in a row|auth_error'` → 0 (`createLog` prints no level word, so grep message patterns, not `error`). 3. Backup: `PATH=$HOME/bin:$PATH deploy/backup.sh` → a new `ea-…dump.age` (log line). Write the backup name. 4. `git fetch && git checkout master && git merge --ff-only origin/master`; `git log -1 --oneline` = the merge commit. 5. Migrate and start (`deploy/README.md`, F11): `$C run --build --rm server bun run db:migrate` → the new version applied; `$C up -d --build --wait`.
    Write `T` = `date -u` after the start. 6. Within 6 minutes: the log has `added sync folders` with the keys that Interia lists (`offers,social,bills,junk`) and one `sync … folder <key>: initial, …`
    line per new folder, `incremental` for INBOX; no failure line (`$C logs --since 10m server | grep -E 'failed|tries again|not on the server|in a row|auth_error'` → nothing unexpected; `createLog` prints no level word). 7. SQL (read-only): `select key, role, enabled, uidvalidity, last_uid from mailbox_folders where mailbox_id = '<MB>' order by key;` → 5 rows; `offers`
    `last_uid` ≥ 38964; `social` ≥ 35156; `bills` ≥ 32543; `junk` ≥ 38892 (F4); none 0.
    `select source_folder, count(*), min(received_at) from emails where mailbox_id = '<MB>' and created_at > '<T>' group by 1;` → `Oferty` about 6–9 rows,
    `min(received_at)` > `T − 24 h`; rows of the other three folders only if new mail came (NV4). 8. After the next triage and committer ticks (about 10 min): `select e.source_folder, t.category, a.type, a.status from emails e join triage_results t on t.email_id = e.id left join actions a on a.email_id = e.id where e.created_at > '<T>' order by 1, 2;`
    → `notification` rows have `mark_read` + move `applied` (`auto` on); the others as the policy table. Write the counts (no subject, no address). 9. Re-sort watch (review M2), 15 and 60 minutes after the first applied move (`triage.returned` clears `returned_at` within 15 s, so count its audit rows; no source folder filter: `markEmailReturned` sets `source_folder` to the folder where the mail came back, so a re-sorted mail would not show with `<> 'INBOX'`; count every `email.returned` row since T):
    `select count(*) from audit_log a join emails e on e.id = a.email_id and e.org_id = a.org_id where a.event = 'email.returned' and a.created_at > '<T>';`
    plus `select count(*) from triage_feedback where source = 'imap_move' and created_at > '<T>';` → 0 both. A count > 0 with no user action = Interia
    sorted a moved mail back: switch moves off at once (`$C run --rm server bun run mailbox:settings switch --org-id <ORG> --mailbox-id <MB> --name move --value off`),
    write the fact, and stop for the user. 10. Commit the time `<T>` into the two pilot-week notes and this task file § Results (master mode, task files only; in a temporary detached
    worktree of `origin/master` as in step 1, push with `git push origin HEAD:master`, then remove it: the main checkout holds other sessions' work, independent review m11).
  - Rollback (write which one ran, if any):
    - One folder misbehaves: `$C run --rm server bun run mailbox:settings sync-folder --org-id <ORG> --mailbox-id <MB> --key <key> --value off` (the next tick
      skips it). This does not stop actions of rows that are already stored: add `switch --name move --value off` when moves are the problem.
    - The whole change: first switch off `offers`, `social`, `bills` and `junk` with `mailbox:settings sync-folder … --value off` (so no new mail of them is
      stored), then `select count(*) from emails where mailbox_id = '<MB>' and source_folder <> 'INBOX' and status in ('pending', 'processing');`
      → wait until it is 0 (the new code triages them with the spam-folder rules; the old code would triage them as INBOX mail: a flag and an urgent notice
      for spam folder mail, re-review n9). Then `git checkout <PREV>` and `$C up -d --build --wait` (the old code runs on the new schema, D3; the migration
      stays; never `db:rollback` after live use, D17, F11). Known effects (D24 d): `ready` moves `{ folder: "inbox" }` end as `bad_payload`; an Undo of
      `Oferty` mail goes to INBOX.
    - Roll forward after a code rollback: before the new code starts again, copy the cursor that the old code wrote:
      `update mailbox_folders f set uidvalidity = m.uidvalidity, last_uid = m.last_uid, updated_at = now() from mailboxes m where f.mailbox_id = m.id and f.key = 'inbox';`
      (as `postgres` through `$C exec -T db psql …`), then switch the four folders on again (discovery never turns a disabled row on; the cursor is cleared, so the next sync takes the last 24 h of each folder; the dedup key stops duplicates): `$C run --rm server bun run mailbox:settings sync-folder --org-id <ORG> --mailbox-id <MB> --key <k> --value on` for `<k>` = `offers`, `social`, `bills`, `junk`; then step 4–8 again. A mailbox that was connected while the old code ran has no INBOX row: first
      `insert into mailbox_folders (org_id, mailbox_id, key, path, role, enabled, uidvalidity, last_uid) select org_id, id, 'inbox', 'INBOX', 'inbox', true, uidvalidity, last_uid from mailboxes on conflict do nothing;`
      (check the column list against the migration first; stage 2 review, 2026-11-09).
  - Test: none (operations).
  - Check: steps 2–9 results as above.
  - Done when: steps 1–10 done; no rollback, or a written rollback with its reason and a stop for the user.
  - Out of scope: `test-mail-traffic` stage 9 (stage 17 unblocks it).
