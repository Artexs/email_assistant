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
