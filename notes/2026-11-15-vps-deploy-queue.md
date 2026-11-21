# VPS deploy queue (coordinator, 2026-11-15)

VPS runs master at `b56d414b` (F101 deploy, 2026-11-15 00:20 UTC). Not live yet:
- F032 (closed `bd9eacde`): store a copy below the UID cursor. Count the new log lines `sync_below_cursor_copies_stored` and `sync_below_cursor_copy_skipped` after the deploy, into `notes/2026-11-07-assist-actions-facts.md` (F032 NV1).
- F104 stages 01–03 (migration `20261115090001_sent_mail.sql`, Sent repo, rules; no Sent sync yet: stage 04+).
- F103 stages 01–03 (CLI output; log field kinds).
- F119 stages 06–07 (SSO required refusal; provider service). Stage 15 is the F119 deploy.
- F112 stage 01 (docs workspace; server image filter): the CI `image` job proves the image.
- F128 (2FA code on disable and new codes): deploy after its re-review and land; the owner checks it in the panel.
- F109 stage 01 (core rules only).
Rule: back up first, tag `ea-server:pre-<ticket>`, deploy a CI-checked pinned commit, verify, then record here.

## Deployed 2026-11-15 05:2x UTC (batch 1)
- VPS now at `df42788b` (detached HEAD; green CI run 43679928874). Before: `b56d414b`. Rollback image `ea-server:pre-batch1115`; backup `ea-20261115T052116Z.dump.age` (470523 bytes). Roll back the code, not the migrations.
- Migrations applied: `20261115090001_sent_mail`, `20261115110001_mailbox_oauth`, `20261115120001_suspicious_urgency_sender`, `20261115130001_approval_edit`.
- Brings: F032, F104 stages 01–08 (flag `sent_sync` off: do NOT turn on before F104 stage 10), F103 stages 01–08, F119 stages 06–11 (stage 12 not in), F128, F112 stage 01, F109 stages 01–04, F117 stages 01, 03–07, F102 stages 01–08, F113 stages 01–05 (sim stack not run here).
- Checks: health 200; no error line in the first 3 minutes; 11 sync lines.
- Open: F128 owner check in the panel (turn 2FA off needs a code); F032 log lines `sync_below_cursor_copies_stored` / `_copy_skipped`: count after a few sync cycles into `notes/2026-11-07-assist-actions-facts.md`; remove `ea-server:pre-batch1115` after 24 h.

## Deployed 2026-11-15 09:5x UTC (batch 2)
- VPS now at `75b05467` (detached HEAD; green CI run 43699716662). Before: `df42788b`. Rollback image `ea-server:pre-batch2`; backup `ea-20261115T094619Z.dump.age` (501984 bytes). Roll back the code, not the migrations.
- Migrations applied: `20261115140001_ops_alerts`, `20261115150001_outbox_sent_missing`.
- Brings: F104 stages 09–12 (flag `sent_sync` stays OFF for every non-lab org: owner decision 46 gates the pilot step), F117 stages 10–11, F103 stages 09–15, F102 stages 09–12, F113 stages 06–13 (lab, not run here), F114 stages 01–03 (`ops.slo` job; alerts go only to `OPERATOR_TELEGRAM_CHAT_ID` if set), F109 stages 05–16, F119 stages 12–14.
- Not in: F114 stage 04 (backup status mount and checks: lands after this commit), F117 stages 12–13, F116 stages 05–06.
- Checks (after T=09:56:09Z): health 200; 0 error lines; sync lines present; 0 `log_call_invalid`/`dropped_fields` lines; `outbox_kind_check` holds `sent_missing`; no `slo_`/`ops_` line yet.
- Open: F104 stage 13 pilot step (turn `sent_sync` on) waits for owner decision 46 and the N5 rule. Remove `ea-server:pre-batch1115` after 24 h and `ea-server:pre-batch2` after the next deploy is checked.

## Deployed 2026-11-15 14:5x UTC (batch 3, release v0.1.0, first release by `deploy/release.sh`)
- VPS now at tag `v0.1.0` = `c461a394` (green CI run on that commit). Before: `75b05467`. Rollback image `ea-server:pre-v0.1.0` (the script kept the running image); backup `ea-20261115T145357Z.dump.age` (505289 bytes). State file `deploy/release-state/state`: `current=v0.1.0`, `previous=pre-v0.1.0`, `pending=` empty. Roll back with `deploy/rollback.sh` (never the migrations). Note: `previous_commit` is `c461a394` (the HEAD that ran the script), not `75b05467`: a rollback keeps the new compose files with the old image.
- Migrations applied: `20261115160001_open_loops`, `20261115170001_action_loop_anchor` (carries `-- contract: v0.1.0`; additive, old code works with it).
- Brings: F103 stages 14–18 (log drivers split, `cli` service, log store), F114 stages 05–08 (release identity, scripts, migration check, restore drill, credentials check), F116 stages 05–09 (extractor, loop tables, repository, action anchor: no code creates loops yet), F102 stages 13–17 (approvals edit, delegates and delegations API, remind now, delegates page: flag `delegation_pages` off), F113 stages 14–15 (lab only), F117 stages 12–13 and 16 (OAuth connect UI: flags off).
- Checks (after 14:59:45Z): health 200; both services healthy; `EA_RELEASE=v0.1.0` in the server and in every log line; 0 `error` lines; 31 sync lines in 4 minutes; 0 `log_call_invalid`/`dropped_fields`/`console_output`; `server` `json-file 10m 5`, `db` `local 10m 5`; migrations at `20261115170001`; disk 22 GB free.
- F103 stage 19: `$C --profile ops up -d --wait victorialogs vlagent` healthy; `/select/vmui/` 200; search check passed (run `f1e9e121-e3ea-456d-aed1-da3b95f822ea`: 8 lines in the log, 8 in the store); marker checks: CLI, `exec` and Postgres lines: 0 in the store; old-form query: 0; memory `victorialogs` 14.7 MiB, `vlagent` 9.1 MiB.
- Open, owner steps (need sudo on the VPS): (1) `sudo tailscale serve --bg --https=9443 --set-path /select http://127.0.0.1:9428/select` (only the `/select/` path, never the whole port); then open `https://email-assistant.tail40d9cf.ts.net:9443/select/vmui/` from a tailnet device. (2) `sudo apt install jq`: `deploy/logs.sh` and the README search steps need `jq` and the VPS has none.
- Finding: `astro-app-container` (another site on this host) uses `json-file`, so vlagent ships its lines too (48 lines in 10 minutes). The store is local, kept 30 days. Say so if the owner does not want it.
- Next: F114 stage 09 (drill on the VPS: Compose 2.40.2 checks of the carry-over, then `restore.sh`), F103 close after the owner does the tailnet step. Remove `ea-server:pre-v0.1.0` only after the next release is checked.

## Deployed 2026-11-15 22:44 UTC (batch 4, release v0.2.0)
- VPS now at tag `v0.2.0` = `3e60a7f5` (green CI run 43768979219). Before: `v0.1.0` = `c461a394`. State file: `current=v0.2.0`, `previous=v0.1.0`, `pending=` empty. Rollback target: `v0.1.0` (`deploy/rollback.sh`; never the migrations). Backup `ea-20261115T223641Z.dump.age` (536924 bytes). The prune removed `ea-server:pre-v0.1.0`.
- Pre-checks at `3e60a7f5`: `db:check-migrations` ok; `docs:stale --strict` 0; no prompt file changed since v0.1.0 (no E2 report needed); contract lines name `v0.1.0` (deployed, the rollback target).
- Migrations applied: `20261115180001_trust_ladder`, `20261115190001_outbox_loop_consent`.
- Sim stack files changed (`deploy/Dockerfile.sim`, `deploy/sim.env.example`), but no `ea-sim` project runs on the VPS: nothing to rebuild (checklist step 4).
- Checks (server start 22:44:12Z, read at 23:01Z): health 200; `EA_RELEASE=v0.2.0`; 0 `error` lines in 91; 8 `sync_done` lines, last 23:00:00Z; 0 `log_call_invalid`/`dropped_fields`/`console_output`; only the 5 startup config warnings; `ops:alerts` "no alerts in the last 7 days"; log drivers `server` json-file 10m 5, others local 10m 5; disk 22 GB free; `jq` present.
- Closed after the deploy: F103, F105 (U1 declined, `outcome.md`), F106, F128. F112 stage 08 was already in master and in v0.2.0.

### Open for the main coordinator (hand-over from the release session, 2026-11-16)
1. Watch end: at or after 23:14Z repeat the counts above since 22:44:12Z (0 `error`, `sync_done` still rising, `ops:alerts` none). On trouble: `deploy/rollback.sh`.
2. F104 stage 13a (time budget of the Sent pass): job `2026-11-15-f104-s13a-sent-budget-risky-sync-8890e7df` runs. When done: Opus 5.5 review (risky: sync of the pilot mailbox) with the TRACK sort line, land check, land.
3. Then release v0.2.1 (`docs/release-checklist.md`). Do NOT turn on `sent_sync` yet: the owner wants to decide it in a later session (owner, 2026-11-16; `notes/owner-later.md` item 4). On the owner's word: F104 stage 13 steps 10–12 and its checks, pilot org only (check N5 first).
4. After v0.2.1 is checked: no extra image to remove (the release script prunes).

## F116 stage 19 (Telegram taps): rollback

- The digest view gains the key `lineOf` and the urgent view the key `delegable` (strict schemas). The code before stage 19 refuses a pending row with either key: the sender ends it `failed` / `bad_view`. On a rollback drain the outbox first (let the pending digests and urgent notices send), or accept the loss of one slot. Rows that were sent are not affected (their text is stored). Stage 18's `loopIds` has the same shape. No migration.

## Release v0.2.1 (2026-11-17)

- CHANGELOG entries written, `Release v0.2.1` = `a1d7b054`, CI green on it, tag `v0.2.1` pushed (19:5x CET). Contents: Sent-pass 60 s budget (stage 13a), legal page drafts, Polish docs pages, plus flagged-off code of F107, F110, F112, F115, F116. Migration `20261117120001_history_model_failing.sql` (contract v0.1.0, deployed). Master later got F115 stage 03's migration `20261117130001`; it is NOT in v0.2.1 (not landed yet).
- NOT DEPLOYED: `ssh home_vm` fails with "No route to host" (192.168.1.198, ping 100 % loss) at ~20:00 CET. Retry; run `nohup bash -c "deploy/release.sh v0.2.1; echo RELEASE_RC=\$?" > /tmp/release-v0.2.1.log 2>&1 &` in `~/email_assistant`; the script backs up and keeps `previous` (v0.2.0) as the rollback target. Then the 30-minute watch (`docs/release-checklist.md` step 10). `sent_sync` stays off until the owner says so.

## Rule: every deploy is a release

Every deploy to the VPS is a release: `deploy/release.sh <tag>` from a tag. No bare commit, no `git checkout` by hand (the bootstrap of `v0.1.0` was the last untagged deploy). The rollback target is the `previous` entry of `deploy/release-state/state` (`deploy/rollback.sh`, never the migrations). Record each release here with its rollback target and backup name.

## Restore drill record (2026-11-19, F114 stage 09 Part C)

- Rollback target of the live stack: `v0.3.0` (`previous_commit` `105fb0c0`), live at `v0.3.1` = `2a86a004`; the drill never touched it. Backup used: `ea-20261119T182245Z.dump.age` (675190 bytes; `backup.sh` 10.7 s; `deploy/backup-status/status.json` `result=ok`).
- Live containers before and after: `email-assistant-db-1` id `bdd78b3d7c26`, started 2026-11-15T14:59:25Z; `email-assistant-server-1` id `fe78a20f034c`, started 2026-11-19T15:38:24Z. Same ids and start times after the drill (step 16 holds).
- Counts: before = drill = after = `organizations=2 users=2 mailboxes=1 emails=313` (D19 holds).
- Result: `restore ok target=drill seconds=173`, `credentials ok=1 failed=0`, wall time 548 s with two failed starts. Drill server: `slo_alert_sent kind=slo_backup_age` at 18:30:30Z (2 min 16 s after the restore end), 0 `sync_` events (the one mailbox is `paused`), `docker stats` 100.7 MiB (server) + 54.4 MiB (db). Compose config: one network `ea-drill_default` 172.29.0.0/24, `server` and `cli` image `ea-drill-server`, no ports, no live secret value in the config.
- Findings: (1) the drill at `v0.1.0` fails at `credentials` (no `credentials:check` before `v0.2.0`); the drill ran at `v0.3.1`. (2) First start on a fresh volume fails at `guard-empty` (db healthy during image init); rerun works; needs a ticket. (3) Not judged: whether the server can sync erased data before the delete replay on a new host: the drill pauses mailboxes, so no sync ran.
- Open: U2 (`BACKUP_PING_URL`, step 8 skipped) and U3 (operator Telegram group; `OPERATOR_TELEGRAM_CHAT_ID` unset in the live `.env`, count 0, so Part B `sent` lines are not shown); Part A step 6 rollback time not measured.
- V1 (disk path), read 2026-11-19 after the drill: `statfs("/")` in `server` 20692127744 bytes, `df -B1 /` on the host 20708917248 bytes: 0.08 % apart, so `SLO_DISK_PATH` stays unset.
- Cleanup: `--down` ran (project, volume, image `ea-drill-server` gone), `~/ea-drill` and `/tmp/f114-drill/` removed. The age key was never printed.

## Restore drill record 2 (2026-11-20, F152: the F139 drill rerun)

- Tag `T` = `v0.4.4` (`current=` of `deploy/release-state/state`, commit `fb1df6d6`; `pending=` empty, no `release.sh` or `rollback.sh` process, live server started 20:51:59Z, so the 30-minute watch had ended). `T` carries `wait_db_tcp`. Newest `db/migrations` file at `T` = live `max(version)` of `schema_migrations` = `20261120110001`. Host time 21:26Z, 17 GB free on `/`.
- Backup used: `ea-20261120T212649Z.dump.age` (717634 bytes), run as `PATH=$HOME/bin:$PATH deploy/backup.sh`, `backup ok`, `status.json` `result=ok`. Backup time: not measured (the timer used `bc`, which the host does not have).
- Live containers before and after: `email-assistant-db-1` id `bdd78b3d7c26`, started 2026-11-15T14:59:25Z; `email-assistant-server-1` id `ba6df47da63e`, started 2026-11-20T20:51:59Z. Same ids and start times after the drill.
- Counts: before = after the backup = drill = after the cleanup = `organizations=2 users=2 mailboxes=1 emails=325`.
- Result, first run, no rerun: `db ready probes=2`, `credentials ok=1 failed=0`, `restore ok target=drill seconds=108`; no line `restore failed at`. `probes=2`: the run saw the init server of the Postgres image, and the TCP wait held until the final server answered. The F139 fix works on a real fresh volume.
- Wall time: the restore pipe 108 s; the drill from the backup to the end of the cleanup about 3 min (21:26:49Z to about 21:29:50Z). The `ea-drill-server` image build used only cached layers (the live `v0.4.4` build had filled the cache), so a cold host takes longer.
- The `migrate` service path ran on a host (`dbmate … migrate` in the `migrate` service at `v0.4.4`; same schema, so it applied nothing). F108 stage 07 can cite this record.
- `ea-sim`: up (5 containers), left running.
- Cleanup: `--down` ran (project, volume `ea-drill_db-data`, network and image `ea-drill-server` gone; `docker volume ls -q --filter name=ea-drill_` prints nothing), `~/ea-drill` and the temp folder on the owner's PC removed. The age key and the plain dump were never printed. The drill output (no secret) is in the job folder `.limen/jobs/2026-11-20-f152-restore-drill-rerun-on-the-f9f18cdd/drill.log`.

## Release v0.3.1 (2026-11-19, 15:38 UTC)

- VPS now at tag `v0.3.1` = `2a86a004` (green CI run on that commit). Before: `v0.3.0` = `105fb0c0`. Rollback target `v0.3.0` (`deploy/rollback.sh`). No migration. `release ok v0.3.1 previous v0.3.0`.
- Brings: phone settings cards (F118 s12), docs and legal drafts (F118 s13, F120 s12), the data request case-form match (F137 s03). The owner accepts the new terms (`2026-11-19`) once at the next sign-in.
- Checks (server start 15:38:24Z): health 200; `EA_RELEASE=v0.3.1`; 0 error lines; `sync_done` present; `ops:alerts` shows only resolved alerts.
- Before this: master CI was red on 2026-11-19 13:36 UTC because `stats-week-cli.test.ts` ran six `bun` starts in a row against a 5 s limit; fixed in `349307a4` (parallel starts).
- F029 stage 05: v0.3.0 (server start 2026-11-19 09:48:21Z) carried stage 04. At 15:15Z: 30 `flags_refreshed`, 0 `user_moves_failed`, 0 `user_moves_found`/`user_moves_retry`, 30 `user_moves_checked`. The 24 h checks are due after 09:48Z on 2026-11-20; v0.3.1 restarted the server at 15:38Z, so count from 15:38:24Z for the rest.

## Release v0.4.0 (2026-11-19, NOT deployed: CI red on the tag)

- Tag `v0.4.0` = `f8cd6af7` ("Release v0.4.0", pushed to `master`). Master CI run 44593637266 on it: `ci` job failed at `bun run test:unit`, 1 fail: `docs/capabilities > every page has the H1, the checked line and the seven sections` (`backups.md`, then `operations.md`). Cause: `4495e7e0` (F114 stage 09 Part C) appended "Limits rechecked …" to the checked line; the line must end at the date. Master CI is red since that commit (runs on `47dc7e7f`, `927a311c`, `4fb8d3a8` show the same fail). `image`, `docs` jobs passed. The `Docs deploy` workflow on the tag passed.
- Fix: commit `6810c69e` on branch `limen/2026-11-19-f102-release-v0-4-0-s20-s07-s26-63018f1a` (checked line alone; extra sentence on its own blockquote line). Local `bun run test:unit:ci`: 6988 pass, 0 fail. Not on `master` yet.
- Next: land the fix, then release `v0.4.1` (the tag `v0.4.0` stays, never deployed, as `v0.2.1`). `[Unreleased]` needs one line for `release:prepare`, e.g. under Fixed: the capability page format. The deploy runbooks of F102 s20, F107 s07, F110 s26, F119 s15 then run on `v0.4.1`.
- VPS facts for that run: the checkout is detached at `2a86a004` (v0.3.1) with `deploy/compose.sim.yaml` modified by the lab (`git status` dirty: `release.sh` refuses). The modified file equals the file at `v0.4.0`. A clean tree with the same content: `git checkout -q -- deploy/compose.sim.yaml && git checkout -q --detach <new tag>` in one command (sha256 of the file before and after is equal: checked 2026-11-19). This does not touch the running `ea-sim` containers. The VPS was put back to the start state after the attempt.
- Baselines read 2026-11-19 ~19:05 UTC (read only): 2 organizations, 1 pilot mailbox; pilot flags on: `sent_sync`, `security_log`, `review_command` (rows); all others off (default); users 2, both `terms_version` `2026-11-12` (current `TERMS_VERSION` `2026-11-19`); `auto` without `grant`: 0; actions with `supersedes_action_id`: 0; `auth_sessions`: only `password` (4); server `"level":"error"` lines in 24 h: 0; disk 20 GB free; `OPERATOR_TELEGRAM_CHAT_ID` set in `.env`.
- Release gate note for `v0.4.x`: `drafter-v1` prompt text changed since `v0.3.1` (F115 stage 02 dev tuning) with no holdout report (checklist step 3). `reply_drafts` is off everywhere; `v0.3.0` shipped the prompt the same way. The coordinator decides.
- Sim stack: `deploy/compose.sim.yaml` changed since `v0.3.1` (checklist step 4). The lab already runs with that content. Do not rebuild `ea-sim` while its live run is active.

## Release v0.4.1 (2026-11-19, 19:32 UTC)

- VPS at tag `v0.4.1` = `4f1e76df` (master CI run 44595141632 green: ci, e2e, image, docs). `release ok v0.4.1 previous v0.3.1`. Rollback target `v0.3.1` (`deploy/rollback.sh`). Backup inside the release: `backup ok`, 676068 bytes. No migration in the range from `v0.3.1`.
- Before `release.sh`: `git checkout -q -- deploy/compose.sim.yaml` (sha256 `d9b43d3c…` before and after the release: equal). `ea-sim` containers untouched (same creation times). The tree is clean at the tag now.
- Config: server start logs `operator_notices_on kind=telegram` (`OPERATOR_TELEGRAM_CHAT_ID` loads). `operator_contact_empty` warn is old (since F089 stage 06): `WEB_BASE_URL` set, `OPERATOR_CONTACT` unset.
- Flags turned on for the pilot organization: `approvals_page`, `delegation_pages` (F102 Q10), `trust_ladder` (F110 U2). The history check was queued by the flag change and ended `done`, cost $0.0152.
- 30-min watch to 20:03 UTC: 0 error lines, 15 `sync_done`, `ops:alerts` only resolved alerts. Check outputs per ticket: `plan.md` § Log of F102, F107, F110, F119.
- Open owner steps: F102 check 8 and U1 (panel through Tailscale), F107 U1 (terms dialog), F110 U2 (`/report`), F119 check 6 (sign-in with TOTP).
- Lesson: a remote script that runs `docker compose exec -T` reads the ssh stdin. Copy the script with `scp` and run it with `</dev/null`; else the rest of a piped script is lost.

## Limen land closed the wrong ticket (2026-11-19)
`limen land` of job `…5dc00e68` (label "F138 stage 01 (judge on OpenAI, for F115 s02)") closed F115. Cause: the coordinator left out `--keep-open`; land closes the active ticket it finds for the job, and F138 is in `planned/`. Fix: `git revert` of the close commit (`47e80b72`). Rule: land with `--keep-open` while the ticket has open stages, and a job label names only its own ticket.

## F108 rollout

### Stage 04, 2026-11-20 (job `2026-11-20-f108-vps-key-cleanup-v0-4-2-depl-f8ed4592`): stopped at the O1 model check, rolled back to v0.4.1

Result: **stopped at step 3 (O1 compare)**. The judge model changed with v0.4.2. The task rule says: a changed model or effort other than the drafter move to `low` is a production change: stop, roll back, report. Part B (env split) and Part C (cron) did not run. No `env split ok`.

- Start state (16:14Z): `df -h /` 18 G free; `git status` clean; state file `current=v0.4.2 previous=v0.4.1 pending=` empty.
- Unrecorded deploy found: another run deployed `v0.4.2` (`34374ba0`) before this job. Image `ea-server:v0.4.2` built 2026-11-20 04:30:12Z; server start 04:31:36Z. No queue-note record of that release exists (no `release ok` line, no backup name). Stage step 1 allows this case ("record that and go to step 3").
- O1 key cleanup: the 12 removed keys (`deploy/README.md` § LLM provider tiers, Update) are absent. Count of `^(LLM_(JUDGE|DRAFTER|EXTRACTOR)_(PROVIDER|MODEL|REASONING)|OPENAI_MODEL_CLASSIFIER|GEMINI_MODEL_CLASSIFIER|OPENAI_REASONING_EFFORT)=`: `.env` 0, `deploy/sim.env` 0, every `.env.bak-*` (5 files, back to 2026-11-07) 0. So the host never held them; nothing was deleted. LLM key names in `.env`: `LLM_PROVIDER`, `LLM_DAILY_CAP`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`. `.env` mtime 2026-11-19 18:57:25Z, before the v0.4.1 start (19:31Z): v0.4.1 ran with this same `.env`.
- O1 step 1 at the old release: the live stack was already at v0.4.2, so the check ran the kept image `ea-server:v0.4.1` as the `cli` service (Compose override `image: ea-server:v0.4.1`, `run --rm -T --no-deps`; the live `server` was not touched). Lines (model, effort):
  - `role=classifier provider=openai model=gpt-6-luna effort=none` (greeting and triage `category=needs_reply`)
  - `role=drafter provider=openai model=gpt-6-luna effort=none`
  - `role=extractor provider=openai model=gpt-6-luna effort=none`
  - `role=judge provider=openai model=gpt-6-luna effort=none`
  - rc 0 for all four.
- O1 step 3 at v0.4.2 (`llm:check --role all`, live image, rc 0):
  - `role=classifier model=gpt-6-luna effort=none` — same
  - `role=drafter model=gpt-6-luna effort=low` — known move, accepted
  - `role=extractor model=gpt-6-luna effort=none` — same
  - `role=judge model=gpt-6.1-terra effort=none` — **changed** (v0.4.1: `gpt-6-luna`). Not the known drafter move.
- Production use of the judge: none seen. Server code calls the judge only in the eval paths (`triage/eval-judge.ts`, `replies/drafter-eval.ts`). `audit_log` `llm.call` rows of the last 3 days: only `classifier gpt-6-luna` (117 before 04:31:36Z, 3 after). So the change had no runtime effect on the pilot that this check could see. The rule still applies; the owner decides.
- Rollback check: no migration in `v0.4.1..v0.4.2` (`git diff --stat v0.4.1 v0.4.2 -- db/migrations` empty). `reply_drafts` off. Pilot flags on: `approvals_page`, `contact_wait`, `delegate_button`, `delegation_pages`, `open_loops`, `review_command`, `security_log`, `sender_context`, `sent_sync`, `trust_ladder`; all were turned on at or before 2026-11-19 20:29Z, so at v0.4.1, and v0.4.1 knows each flag.
- Rollback (checklist step 11), 16:20:01Z: `deploy/rollback.sh` → `rollback ok v0.4.1`, rc 0. State now `current=v0.4.1 previous=v0.4.2 pending=` empty; checkout detached at `v0.4.1`. Server start 16:20:11Z, healthy; health 200; `EA_RELEASE=v0.4.1`. Live judge line: `role=judge model=gpt-6-luna effort=none`. Start log: 0 `error`, 0 `config_key_bad`; first `sync_done` by 16:22:15Z (2-minute interval), with `sent_sync_done` and 5 `sync_folder_done`, still 0 `error`. `ops:alerts`: only resolved alerts (`slo_backup_age`, `slo_sync_lag`). `ea-sim` containers untouched (same uptime, 22 h). No backup ran in this job (the rollback needs none; no DB change).
- Not changed: `.env`, `deploy/sim.env`, the crontab (0 lines hold `--env-file .env`; 1 line, `30 3 * * *`), the DB.
- Next (owner decision): accept the judge on the strong tier (`gpt-6.1-terra`) or not. If accepted: `deploy/rollback.sh` again goes forward to v0.4.2 (a second run swaps `current` and `previous`), then F108 stage 04 from step 3 (checks), then Part B. If not: a code change of the tier map ships in a new patch release first.

### Stage 04, 2026-11-20, runs 2 and 3 (job `2026-11-20-f108-env-split-and-cron-after-th-e893bbfb`): env split ok

Result: **env split ok**. Release N is `v0.4.2`; rollback target `v0.4.1` (after the split: `deploy/env-split.sh --undo` first, see stage 04 § Rollback). Logs on the VPS: `~/ea-logs/f108-s04b/` (run 2, steps 1–5) and `~/ea-logs/f108-s04c/` (run 3, steps 4–10).

- Owner decision: the judge on the strong tier (`gpt-6.1-terra`) is accepted. Run 2 went forward again, 16:24:50Z: `deploy/rollback.sh` → `rollback ok v0.4.2`, rc 0; state `current=v0.4.2 previous=v0.4.1 pending=` empty (`01-forward.log`).
- Step 3 (run 2, `02-checks-n.log`, `03-sync-n.log`): `llm:check` rc 0, classifier/drafter/extractor `gpt-6-luna`, judge `gpt-6.1-terra`; `ops:alerts` only resolved alerts; `sync_done` and `sent_sync_done` at 16:26Z, 0 `error`.
- Step 4 (`f108-s04c/04-v3-recheck.log`, the tool's own match): each of `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD`, `MIGRATOR_DATABASE_URL` strict=1 loose=1 (no `export`, no indent, no key twice); state `old`; no `deploy/db.env`.
- Step 5, backup before the change:
  - Run 2 (16:26:19Z, `f108-s04b/05-backup.log`) and run 3 first try (16:34:42Z, `f108-s04c/05-backup.log`): `rclone copyto failed after 5 tries`, rc 1, each try `Failed to create file system for destination "b2:email-assistant/pilot/": Unknown 401`.
  - Cause, proved: an `ssh home_vm 'cmd'` shell has no `~/bin` in `PATH`, so `deploy/backup.sh` ran the apt `/usr/bin/rclone` v1.53.3. That version fails at the B2 login with the write-only key. The cron `PATH` starts with `/home/serwer/bin` (`rclone` v1.75.2). Probe `05b-rclone-probe.log`: 1.53.3 fails at `Failed to create file system`; 1.75.2 gets past the login (its `lsf` 401 is the normal write-only answer). The B2 key is good. Known alert: `docs/known-alerts.md` (fix line "run `backup.sh` with `PATH=$HOME/bin:$PATH`"); `deploy/README.md` § Backups step 4.
  - Run 3 with the cron `PATH` (16:43:27Z, `05c-backup-cron-path.log`): `backup ok ea-20261120T164328Z.dump.age 707961`, rc 0.
  - Side effect: the failed status of 16:34Z opened `slo_backup_age` at 16:35:30Z (1 notice sent to the operator); it resolved 16:45:30Z.
  - The nightly failures of 2026-11-18 and 2026-11-19 were DNS (`lookup api.backblazeb2.com … server misbehaving`), not a 401 (`~/ea-logs/backup.log`).
- Step 6 (16:44:20Z, `06-env-split.log`): `env split ok moved=4`, rc 0; state `split`; `deploy/db.env` mode 600 holds the 4 names; 0 of them left in `.env`. `git status`: only the untracked `..env.swp` (a vim swap file of `.env` from 16:28Z, not ours, not touched; no vim process ran at 16:44Z).
- Step 7 (`07-compose-check.log`): new `C=` (`--env-file deploy/db.env`): `$C config --quiet` rc 0, 0 bytes out; `server` and `db` healthy.
- Step 8 (16:44:34Z, `08-server-up.log`, `08b-sync-after-split.log`): `$C up -d --wait server` rc 0 (server recreated); health 200; `EA_RELEASE=v0.4.2`. Server env: 0 of the three passwords; `MIGRATOR_DATABASE_URL` 1 (Compose `environment:` at N; stage 05 removes it). After the start: `sync_done`, `sent_sync_done`, 5 `sync_folder_done`, 0 `error`. `$C run --rm -T migrate` rc 0, no migration applied. `ops:alerts`: only resolved alerts.
- Step 9 (`09-crontab.log`): crontab 2 lines (`PATH=…`, `30 3 * * *` backup). Lines with `--env-file .env`: before 0, after 0; no edit needed. `deploy/backup.sh` takes the Compose flags from `deploy/compose-lib.sh` (`deploy/backup.env` has no `COMPOSE`). Old crontab kept: `~/ea-logs/f108-s04c/crontab-before-split.txt`, mode 600 (keep until stage 06 ends).
- Step 10 (16:45:32Z, `10-backup-after-split.log`, cron `PATH`): `backup ok ea-20261120T164532Z.dump.age 707956`, rc 0; `status.json` `result` `ok`.
- Not changed: the DB (no restore, no `down -v`), `deploy/sim.env`, the crontab, `..env.swp`.
- Agents: run a manual backup over ssh as `PATH=$HOME/bin:$PATH deploy/backup.sh`, never bare.
- env split ok. Stage 05 may be spawned now.

### Stage 06, 2026-11-20 (job `2026-11-20-f108-release-v0-4-3-and-backup-c-02079832`): backups and env copies done, release v0.4.3 NOT deployed

Logs on the VPS: `~/ea-logs/f108-s06/` (`01-pre.log` … `05-cleanup.log`).

- Step 1 (`01-pre.log`): `ea_env_split_state` → `split`. State `current=v0.4.2 previous=v0.4.1 pending=` empty; checkout at `v0.4.2`, `git status` clean (the old `..env.swp` is gone); 18 G free. `ea-sim` containers untouched (created 2026-11-19).
- Step 2, release commit: `6b249098` holds `package.json` version `0.4.2`, and `deploy/release.sh` refuses a tag whose `package.json` version differs. So the tag cannot sit on `6b249098` itself. Release commit `a03575252` ("Release v0.4.3", parent `6b249098`, only `package.json` and `CHANGELOG.md`; `db:check-migrations` ok, `docs:stale --strict` stale 0) is on the pushed branch `task/release-v0.4.3`; CI run 44796745878 on it is green (ci, image, docs, e2e). `release.sh` also refuses a tag that is not an ancestor of `origin/master`, so the release commit must reach `master` first. This job merged it into its own branch; the land of that branch puts it on `master`. No tag `v0.4.3` pushed yet.
- Next for the release (a new job after the land): `git tag -a v0.4.3 -m v0.4.3 a03575252 && git push origin v0.4.3`; on the VPS `nohup bash -c "deploy/release.sh v0.4.3; echo RELEASE_RC=\$?" > ~/ea-logs/f108-s06/06-release.log 2>&1 &` (not near 03:30); expect `release ok v0.4.3 previous v0.4.2`; rollback target `v0.4.2`. Then step 3: `deploy/check-server-env.sh` → `server env ok keys=<n>`; `$C run --rm -T cli env | cut -d= -f1` has none of `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD`, `MIGRATOR_DATABASE_URL`; step 4 the 30-minute watch. The migration `20261119140001_emails_neutral_names.sql` is an expand step (two new columns, a copy trigger); a rollback is `deploy/rollback.sh` alone.
- Step 5 (`02-backups.log`): 1 crontab line for `deploy/backup.sh`: `30 3 * * * cd /home/serwer/email_assistant && <cut>`. `status.json`: `result=ok`, `last_ok_at=2026-11-20T16:45:40Z` (2.1 h old at 18:5xZ). Last `backup ok` line of `~/ea-logs/backup.log`: `ea-20261120T033001Z.dump.age 697994` (the nightly run). It is not the `status.json` name `ea-20261120T164532Z.dump.age`: that run was the manual stage 04 run, which logged to `~/ea-logs/f108-s04c/10-backup-after-split.log` (its `backup ok` line holds that name). Counts in `backup.log`: `rclone copyto try` 0, `another backup run holds` 0 over the last 7 days and over the whole file. No overlap.
- Step 6: `ops:alerts` rc 0, only resolved alerts (`slo_backup_age` opened 16:35:30Z resolved 16:45:30Z; older `slo_backup_age` and `slo_sync_lag`, resolved). `OPERATOR_TELEGRAM_CHAT_ID` set; `BACKUP_PING_URL` empty: owner step U2 (Healthchecks URL) is still open.
- Step 7: this PC has no `rclone` (`which rclone`: not found), so no remote. Bucket listing: owner step O1.
- Step 8: lifecycle not read (no read remote).
- Step 9 (`03-candidates.log`): `~` none; `~/email_assistant`: `.env.bak-20261119-operator`, `.env.bak-f069`, `.env.bak-f097-c2`, `.env.bak-f099`, `.env.bak-s5e`; `deploy/`: only the allowed files.
- Step 10 (`04-compare.log`, script in a mode-700 `mktemp -d` folder, removed after; key names and words only): `.env.bak-20261119-operator` 32 same, `.env.bak-f097-c2` 31 same, `.env.bak-f099` 30 same → removed (`05-cleanup.log`). Kept: `.env.bak-f069` (28 same; `OPENAI_API_KEY` differs, `WEB_TRUSTED_PROXIES` differs) and `.env.bak-s5e` (26 same; `OPENAI_API_KEY` differs). Owner item: `notes/owner-later.md` item 5.
- Step 11: `~/ea-logs/f108-s04c/crontab-before-split.txt` removed.
- Step 12: `docs/capabilities/backups.md` § Limits holds the check date, the cron time, "owner step O1", "lifecycle not read" and the env layout line.
- Not changed: the DB (no restore, no `down -v`), `.env`, `deploy/db.env`, `deploy/backup.env`, `deploy/sim.env`, the crontab, the `ea-sim` stack. No backup ran in this job.

### Stage 06 release, 2026-11-20 (job `2026-11-20-f108-release-v0-4-3-on-the-vps-s-9f6492a4`): release ok v0.4.3, server env ok

Release N+1 is `v0.4.3` (`a03575252`); rollback target `v0.4.2` (`deploy/rollback.sh` alone; the host is split and `v0.4.2` reads `deploy/db.env`). Logs on the VPS: `~/ea-logs/f108-s06/06-release.log`, `07-env.log`, `08-watch.log` (watch script `watch.sh` beside them; it prints counts and event names only).

- Tag: `git tag -a v0.4.3 -m v0.4.3 a03575252`, pushed 19:27Z; `git ls-remote origin refs/tags/v0.4.3^{}` → `a03575252f6f…`. `a03575252` is an ancestor of `origin/master`; CI run 44796745878 on it green.
- Pre-checks (19:28Z): 18 G free; `git status` clean; state `current=v0.4.2 previous=v0.4.1 pending=` empty. Far from the 03:30 backup cron.
- Step 2 (19:28:06Z, `nohup bash -c 'deploy/release.sh v0.4.3; echo RELEASE_RC=$?'`): `backup ok ea-20261120T192809Z.dump.age 710765`; `Applying: 20261119140001_emails_neutral_names.sql` (the expand step: two new columns and a copy trigger); server recreated and healthy 19:35:58Z; old image `ea-server:v0.4.1` untagged; `release ok v0.4.3 previous v0.4.2`; `RELEASE_RC=0`. State now `current=v0.4.3 previous=v0.4.2 pending=` empty; checkout at `v0.4.3`, `git status` clean.
- Step 3 (19:36:52Z, `07-env.log`): `bash deploy/check-server-env.sh` → `server env ok keys=38`, rc 0. `$C run --rm -T cli env` key names (names only, rc 0), 39: `ACTIONS_SCOPE AGENTMAIL_API_KEY BACKUP_STATUS_FILE BUN_INSTALL_BIN BUN_RUNTIME_TRANSPILER_CACHE_PATH CREDENTIALS_KEY CREDENTIALS_KEY_VERSION DATABASE_URL EA_RELEASE GEMINI_API_KEY GEMINI_MODEL HEARTBEAT_URL HOME HOSTNAME LLM_PROVIDER LOG_FORMAT LOG_LEVEL OPENAI_API_KEY OPERATOR_TELEGRAM_CHAT_ID OPERATOR_USER_IDS PATH PORT PWD SEND_SCOPE SEND_TEST_ADDRESSES TELEGRAM_API_HASH TELEGRAM_API_ID TELEGRAM_BOT_TOKEN TEST_IMAPS_PORT TEST_IMAP_HOST TEST_IMAP_PORT TEST_MAILBOX_ADDRESS TEST_SENDER_ADDRESSES TEST_SMTP_PORT TRIAGE_LLM_SCOPE WEB_AUTH_SECRET WEB_BASE_URL WEB_DIST WEB_TRUSTED_PROXIES`. None of `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD`, `MIGRATOR_DATABASE_URL` (count 0). `$C config --format json` not printed.
- Start log (19:36Z–19:38Z): `sync_done`, `sent_sync_done`, 5 `sync_folder_done`, 0 `error`. Warns: `actions_scope`, `send_scope`, `triage_scope`, `scope_targets`, `operator_contact_empty` (config warns; `operator_contact_empty` is also in `v0.4.2` `main.ts`, so not new).
- Step 4, 30-minute watch (checklist step 10), 19:37:28Z–20:07:46Z (`08-watch.log`, a tick each 5 minutes over `deploy/logs.sh --since 40m`): `EA_RELEASE=v0.4.3`; each of 6 ticks `error=0`, health 200, container `healthy restarts=0`; `sync_done` count grew 3 → 15. Error events in the window: none. Warn events: the 5 start-up config warns once each, nothing later. `ops:alerts` rc 0: only resolved alerts (`slo_backup_age` 2026-11-20 16:35Z–16:45Z and 2026-11-18–19; `slo_sync_lag` 2026-11-17–19). No rollback.
- `ea-sim` containers untouched (up 25 h at 19:49Z). Crontab 2 lines (unchanged).
- Not changed: the DB beyond the release migration (no restore, no `down -v`), `.env`, `deploy/db.env`, `deploy/backup.env`, `deploy/sim.env`, the crontab, the `ea-sim` stack (not rebuilt).

### F108 checkpoint

Stage 07, 2026-11-20 21:33Z–21:44Z, at `v0.4.4` (job `2026-11-20-f108-final-production-checkpoint-b172480f`). Result: **the smoke organization went through invite, set password, suspended, active and delete; the pilot kept syncing.** Logs on the VPS: `~/ea-logs/f108-s07/` (`00-guardtest.log` … `08-after.log`, helper `s07.sh` beside them; it prints ids, codes, counts and dates only). `C` = `docker compose -f deploy/compose.yaml --env-file deploy/db.env`; each CLI ran as `$C run --rm -T cli bun run <cmd> </dev/null`.

- Pilot id guard: `s07.sh` reads `org:status` before each write (`plan`, `delete`), takes the org with `mailboxes total=1 active=1` and `plan=active` as the pilot, and refuses (exit 3) when the target equals it. Probe (`00-guardtest.log`): `guardtest <pilot id>` → `guard refused: target is the pilot id`, exit 3; `guardtest <old trial org>` → `guard ok`. Each write below printed `guard ok target=3a9977f3-… pilot=ac6ed6a2-… differ` first.
- Step 1, before (21:33Z, `01-before.log`): pilot `org ac6ed6a2-ee37-461f-9632-cc08cf549e40 plan=active trial_ends_at=- max_mailboxes=2`, `mailboxes total=1 active=1`, `last_sync=2026-11-20T21:32:01Z`, `telegram_chats=1`; the second org `d615e7eb-…` (`plan=trial`, 0 mailboxes) was not touched. `ops:alerts` rc 0, only resolved alerts (`slo_backup_age` 2026-11-20 16:35Z–16:45Z and 2026-11-18–19, `slo_sync_lag` 2026-11-17–19). Health 200; `EA_RELEASE=v0.4.4`. Pilot `sync_done` in the 15 min before: 7, 0 `error`.
- Step 2 (21:35:29Z, `02-invite.log`): `$C exec -T server bun run org:invite --org-name "F108 smoke 2026-11-20" --email f108-smoke-20261120@x.test --display-name "F108 smoke" --lang en` → `created org 3a9977f3-f320-48f9-988d-54b11dfeb0aa user <smoke user id> plan trial`, `invite link made`. The link went to a mode-600 file, then to a mode-700 temp folder on the PC; it was never printed. Both copies are deleted.
- Step 3 (21:36Z, `03-after-setup.log`): Playwright from the PC over the tailnet opened the link, set a random password (never printed) and accepted the terms → `setup ok path=/onboarding`. `org:status --org-id <new>` rc 0: `plan=trial`, 0 mailboxes. DB: `members=1 terms_set=1 terms_version=2026-11-20 roles=owner`. Browser check before the pause: `GET /api/me` 200 `plan=trial`; `PATCH /api/me/digest-times` 200.
- Step 4: connect and triage: not verified (no test mailbox; owner step O2 not given).
- Step 5 (21:37:04Z, `05-suspend.log`): `org:plan --org-id <new> --plan suspended` rc 0 → `plan trial → suspended … cancelled 0 queued messages`. As the smoke user: `PATCH /api/me/digest-times` → `403 {"error":"org_suspended"}`; `GET /api/me` → `plan=suspended`; the paused banner text shows once on `/settings`. Log 21:37:05Z–21:40:03Z (`05b-logs-after-suspend.log`): 0 lines with the new org id; the same filter found 2 pilot `sync_done` lines, so it sees org ids. Telegram "account paused": not verified (no second Telegram account; owner step O2 not given).
- Step 6 (21:40:23Z, `06-active.log`): `org:plan --org-id <new> --plan active` rc 0 → `plan suspended → active … resumed_at 2026-11-20T21:40:37Z`. Audit rows `org.plan_changed` of the new org: 2 (`trial->suspended` 21:37:14Z, `suspended->active` 21:40:37Z). `PATCH /api/me/digest-times` → 200; `GET /api/me` → `plan=active`, no banner.
- Step 7 (21:40:58Z, `07-delete.log`): `org:delete --org-id <new> --confirm "F108 smoke 2026-11-20"` rc 0 → `deleted 3a9977f3-f320-48f9-988d-54b11dfeb0aa: mailboxes 0`. `org:status --org-id <new>` → `organization not found`, rc 1. There is no CLI check of the account-data work for this, so a query over `information_schema`: 37 public tables with an `org_id` column, 0 rows with the new id; `organizations` 0; users with the smoke address 0; rows with the smoke user id in each `user_id` column and in `users.id`: 0. The stored browser session then got `401 unauthorized`.
- Step 8, after (21:43:22Z, `08-after.log`): pilot `plan=active trial_ends_at=- max_mailboxes=2`, `mailboxes total=1 active=1`, `last_sync=2026-11-20T21:42:02Z`, `telegram_chats=1` (same as step 1). New pilot `sync_done` after step 7: 1, at 21:42:02Z. `ops:alerts` rc 0: the same 3 resolved alerts, none open. Health 200. Totals `orgs=2 users=2` (as before). Server `error` lines 21:33Z–21:44Z: 0. Pilot `org.plan_changed` rows since 21:30Z: 0.
- Close step 9, CI (21:47Z, `gh run list --branch master --workflow CI`): the last three completed runs are green, each with `ci`, `e2e`, `image`, `docs` = success: 44820233357 (`e492c3464`), 44820167488 (`977b45e20`), 44818310584 (`5d893e498`). Six newer runs were still in progress. `docs/known-alerts.md`: the entry `runSend > 3 …` / `AgentMail fake > holdResponseNext` has status `fixed (4ad0fbd)` (confirmed, not edited).
- Close step 10, restore: drill 1 (2026-11-19, `v0.3.1`, `restore.sh` 173 s, counts equal) and drill 2 (2026-11-20, `v0.4.4`, which holds `deploy/compose-lib.sh` and runs `migrate` in `restore.sh`; 108 s, first run) are cited in `docs/capabilities/backups.md` § Limits. V4 (the new restore path on a host) is proven by drill 2.
- Browser checks: Playwright from a temp folder in the job worktree (not committed, removed). The PC `/tmp` had 0 free inodes (`df -i /tmp`: 100 %), so the first launch failed with `ENOSPC` before it opened the link; the run used `TMPDIR` in the worktree.
- `ea-sim`: up (5 containers, 27 h), not touched. Not changed: the pilot org, the old trial org, `.env`, `deploy/db.env`, the crontab, the release state (`current=v0.4.4 previous=v0.4.3`). No restore, no `down -v`, no backup run.

## Release v0.4.4 (2026-11-20, 20:52 UTC; job `2026-11-20-f062-release-v0-4-4-with-two-mig-48f50988`): release ok v0.4.4, server env ok

Release N+1 is `v0.4.4` (`fb1df6d64`, "Release v0.4.4"). It holds two migrations: `20261120100001_style_text_copy.sql` (data only: the organization signature `organizations.style_text` moves into the mailbox profiles, then the column is emptied) and `20261120110001_drop_old_cursor_columns.sql` (contract step of v0.4.3: drops `emails.inbox_uid`, `emails.undo_pending_at`, `mailboxes.uidvalidity`, `mailboxes.last_uid` and the trigger `emails_copy_renamed_columns`). Logs on the VPS: `~/ea-logs/f062-release/` (`00-pre-counts.log`, `release.log`, `01-after.log`, `02-watch.log`; `watch.sh` is the v0.4.3 watch script with a new header).

- Rollback: `deploy/rollback.sh` alone goes to `v0.4.3` (no SQL; v0.4.3 names no dropped column). A rollback to `v0.4.2` or older is not possible on this schema: restore the backup `ea-20261120T204545Z.dump.age` that `release.sh` took before the migration (`deploy/README.md` § Synced folders, § Backups). Rollback target now `v0.4.3`.
- CI: run 44811308593 (workflow CI: ci, image, docs, e2e) on `fb1df6d64` success at 20:45Z; the only workflow on that commit. Tag `git tag -a v0.4.4 -m v0.4.4 fb1df6d64`, pushed 20:45Z; `git ls-remote origin 'refs/tags/v0.4.4^{}'` → `fb1df6d64370…`.
- Pre-checks (20:27Z): `ea_env_split_state` → `split`; state `current=v0.4.3 previous=v0.4.2 pending=` empty; checkout at `v0.4.3`, `git status` clean; 18 G free. Far from the 03:30 backup cron.
- Pre counts (`00-pre-counts.log`): organizations with non-null `style_text` 0 (non-blank 0); profiles with a signature 0; mailboxes 1; the four old columns present 4. So the copy migration had nothing to copy: no mailbox signature came from it. The migration prints no row counts (dbmate logs only `Applied: … in 121ms`).
- Release (20:45:44Z, `nohup bash -c 'deploy/release.sh v0.4.4; echo RELEASE_RC=$?'`): `backup ok ea-20261120T204545Z.dump.age 720439`; `Applying: 20261120100001_style_text_copy.sql` (121 ms), `Applying: 20261120110001_drop_old_cursor_columns.sql` (166 ms); server recreated and healthy 20:52Z; `server env ok keys=38`; old image `ea-server:v0.4.2` untagged; `release ok v0.4.4 previous v0.4.3`; `RELEASE_RC=0`. State now `current=v0.4.4 previous=v0.4.3 pending=` empty; checkout at `v0.4.4`, `git status` clean.
- After (20:53Z, `01-after.log`): `bash deploy/check-server-env.sh` → `server env ok keys=38`, rc 0. `information_schema.columns` count of the four dropped columns: 0. Organizations with non-null `style_text`: 0. Mailboxes with no INBOX folder row: 0. Triggers on `emails`/`mailboxes`: only `emails_skip_tombstoned`; no function named like `copy` or `neutral` left.
- Start log: first `sync_done`, `sent_sync_done` and `sync_folder_done` of the new server inside 13 minutes (6, 6, 30), 0 `error`. Warns: the same 5 start-up config warns as v0.4.3 (`actions_scope`, `operator_contact_empty`, `scope_targets`, `send_scope`, `triage_scope`).
- 30-minute watch (checklist step 10), 20:53:17Z–21:23:37Z (`02-watch.log`, a tick each 5 minutes over `deploy/logs.sh --since 40m`): `EA_RELEASE=v0.4.4`; each of 6 ticks `error_40m=0`, health 200, container `healthy restarts=0`; `sync_done` count grew 3 → 15. Error events in the window: none. Warn events: the 5 start-up warns once each. `ops:alerts` rc 0: only resolved alerts (`slo_backup_age` 2026-11-20 16:35Z–16:45Z and 2026-11-18–19; `slo_sync_lag` 2026-11-17–19). No rollback.
- `ea-sim` containers untouched (up 27 h at 21:24Z). Crontab 2 lines (unchanged).
- Not changed: the DB beyond the release migrations (no restore, no `down -v`), `.env`, `deploy/db.env`, `deploy/backup.env`, `deploy/sim.env`, the crontab, the `ea-sim` stack (not rebuilt).

## Release v0.4.5 (2026-11-21, 01:58 UTC; job `2026-11-21-release-v0-4-5-retry-with-the-pr-0c1d46d6`): release ok v0.4.5, server env ok

Release N+1 is `v0.4.5` (`f43f78777`, "Release v0.4.5: reword the user line so it holds no flag text"; package.json 0.4.5). It holds one migration: `20261120120001_drop_style_text.sql` (contract step of v0.4.4: drops `organizations.style_text`; v0.4.4 copied the data). It also moves the legal version to `2026-11-20.3` (every member accepts the terms again) and brings new public claims and papers. No flag changes. Logs on the VPS: `~/ea-logs/v0.4.5/` (`00-pre-counts.log`, `release.log`, `01-after.log`, `02-watch.log`, `03-end.log`; `watch.sh` is the v0.4.4 watch script with a new header).

- First try (job `2026-11-21-release-v0-4-5-with-the-privacy-5588034e`): stopped before the tag. CI on the first release commit `92fbb69c2` was red: `apps/docs/src/flagged-text.test.ts` "the changelog page > T10" found the text of the default-off flag `reply_drafts` in a CHANGELOG user line. `f43f78777` rewords that line. No VPS change in that try.
- Rollback: `deploy/rollback.sh` alone goes to `v0.4.4` (no SQL; v0.4.4 stopped using `style_text`, CHANGELOG 0.4.5). An older release needs a restore of the backup `ea-20261121T015050Z.dump.age` that `release.sh` took before the migration (`deploy/README.md` § Backups). Rollback target now `v0.4.4` (image `ea-server:v0.4.4` kept).
- CI: run 44850500777 (workflow CI: ci, image, docs, e2e) on `f43f78777` success at 01:50Z; the only workflow on that commit. Tag `git tag -a v0.4.5 -m v0.4.5 f43f78777`, pushed 01:50Z; `git ls-remote origin 'refs/tags/v0.4.5^{}'` → `f43f787773a2…`. The tag push ran "Docs deploy": success.
- Pre-checks (01:4xZ): `ea_env_split_state` → `split`; state `current=v0.4.4 previous=v0.4.3 pending=` empty; checkout at `v0.4.4`, `git status` clean; 17 G free; terms served `2026-11-20`. Far from the 03:30 backup cron.
- Pre counts (`00-pre-counts.log`, 01:50:40Z): `style_text` columns on `organizations` 1; organizations with non-blank `style_text` 0; `org_features` rows 10 and an md5 of all its rows (`9e13386b…`).
- Release (01:50:51Z, `nohup bash -c 'deploy/release.sh v0.4.5; echo RELEASE_RC=$?'`): `backup ok ea-20261121T015050Z.dump.age 722597`; `Applying: 20261120120001_drop_style_text.sql` (169 ms); server recreated, started 01:58:08Z; `server env ok keys=38`; old image `ea-server:v0.4.3` untagged; `release ok v0.4.5 previous v0.4.4`; `RELEASE_RC=0`. State now `current=v0.4.5 previous=v0.4.4 pending=` empty; checkout at `v0.4.5`, `git status` clean.
- After (01:58:53Z, `01-after.log`): `bash deploy/check-server-env.sh` → `server env ok keys=38`, rc 0. `information_schema.columns` count of `organizations.style_text`: 0. Terms version served on `/legal/en/terms` and `/legal/pl/terms`: `2026-11-20.3`. Health 200, `EA_RELEASE=v0.4.5`. `org_features` md5 unchanged.
- Start log (first 10 minutes): `sync_done` 2, `sent_sync_done` 2, `sync_folder_done` 10, 0 `error`. Warns: the same 5 start-up config warns as v0.4.4 (`actions_scope`, `operator_contact_empty`, `scope_targets`, `send_scope`, `triage_scope`).
- 30-minute watch (checklist step 10), 01:59:01Z–02:29:17Z (`02-watch.log`, a tick each 5 minutes over `deploy/logs.sh --since 40m`): `EA_RELEASE=v0.4.5`; each of 6 ticks `error_40m=0`, health 200, container `healthy restarts=0`; `sync_done` count grew 3 → 15. Error events in the window: none. Warn events: the 5 start-up warns once each. `ops:alerts` rc 0: only resolved alerts (`slo_backup_age` 2026-11-20 16:35Z–16:45Z and 2026-11-18–19; `slo_sync_lag` 2026-11-17–19). No rollback.
- End (02:29:57Z, `03-end.log`): `org_features` md5 unchanged (`9e13386b…`): no flag changed. `ea-sim` containers untouched (5, up 31 h). Crontab 2 lines (unchanged).
- Not changed: the DB beyond the release migration (no restore, no `down -v`), the feature flags, `.env`, `deploy/db.env`, `deploy/backup.env`, `deploy/sim.env`, the crontab, the `ea-sim` stack (not rebuilt).

## Demo run for F151 (C1)

Started 2026-11-20 16:36 UTC on the VPS sim stack (`ea-sim`) by `demo-reset --yes`, beside the live lab day run (owner decision 2026-11-20: do not wait for it).

- Run id: `week-20261123-b99f`, org `demo` ("Kordelan demo", id `a6716460-341a-46c9-983b-b4b386320a6f`), cap $5.00, 855 planned mails, `modePlan.assistFromDay` 4. Mailbox mode now `shadow`.
- Start date: 2026-11-23 (Monday). A week run starts only on a Monday (`planLiveRun` refuses `not_monday`), so "now" means the next Monday; no `--date` was passed (the default is the first Monday after today). The run is active now and waits for its first slot (2026-11-23T04:37Z).
- Day 1–3 shadow: 2026-11-23 to 2026-11-25. Assist from 2026-11-26 00:00 Warsaw (2026-11-25T23:00Z).
- **End of day 5: 2026-11-27T23:00:00Z** (2026-11-28 00:00 Warsaw). Run `endsAt` (day 7) 2026-11-29T23:00Z, `tailEndsAt` 2026-12-03T23:00Z.
- Serve ticks it: first tick at 16:36:38Z wrote the `seen` events (Telegram cursor, three bot inbox cursors); `serve.json` lists both runs with no failures.
- Classifier setup: sim image `ea-sim-base:v0.3.1` (`EA_RELEASE=v0.3.1`), `LLM_PROVIDER=openai`, prompt pointer `classifier-v2` at v0.3.1 (`prompts/index.ts`), model `gpt-6-luna` (the 121 classifier `llm.call` rows of the last day on the sim DB all have that model). The lab demo code (`modules/lab/demo-seed`, `reset.ts`, `start.ts`, `serve*.ts`) equals master except one test file.
- Month budget at start: no ledger file yet (spend 0); active caps $1 (lab day run) + $5 (demo).
- Preview before the reset: `would delete org none and 0 mails` of the demo mailbox (no demo org existed). The lab org, its run (`day-20261120-215c`), the `ea-sim` containers (created 2026-11-19) and the production stack were not touched.
- Export after 2026-11-27T23:00Z (not before): `bun run lab demo-export --day 5 --out ~/.local/share/email-assistant/demo/demo-seed-day5.json` (the D6 path of F121, mode 0600). On the VPS it runs in the `lab` container: `$L demo-export --day 5 --out /var/lib/ea-lab/demo-seed-day5.json`, then `$S cp lab:/var/lib/ea-lab/demo-seed-day5.json /tmp/` and copy the file to the D6 path on the owner's PC. First a trial export after day 1 (`deploy/README.md` § Sim stack, step 12).
- VPS checkout note: an untracked `..env.swp` (a vim swap file of `.env`) is in `~/email_assistant`; it was there before this job and was not touched.
