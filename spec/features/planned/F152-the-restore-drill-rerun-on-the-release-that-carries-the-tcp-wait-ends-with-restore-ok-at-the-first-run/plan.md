# F152 plan — restore drill rerun on a release with the TCP wait

> **Status 2026-11-20 — planned.** Plan base: fb1df6d64. Two stages: 01 coordinator VPS drill and record, 02 worker test hardening. They may run at the same time. No migration, no `bun.lock` change.

## Input

Ticket text (from F139 stage 02, word for word): "after release v0.4.2 (carries F139 stage 01, commit 38180f55), run the drill in project `ea-drill` on a fresh volume as `deploy/README.md` § Drill says: check first that no `ea-drill_` volume is left (`docker volume ls --filter name=ea-drill_`; with a leftover volume, run `--init-env` then `restore.sh --target drill --down` — in a fresh clone there is no `deploy/drill.env`, so `--down` refuses without it), run once, no rerun on failure. Expected: `restore ok`, a line `db ready probes=<n>`. Write the result into the drill record (`deploy/README.md` § VPS lost, `notes/2026-11-15-vps-deploy-queue.md`) and set `docs/known-alerts.md` § restore drill to fixed. Optional hardening from review 1: F139-2 asserts the 3 `sleep` calls. Build after: release v0.4.2 is deployed."

Coordinator task (2026-11-20): "release v0.4.3 is live on the VPS; v0.4.4 (two migrations) is being released now. Name Build after, risk marks, whether a migration or bun.lock change is needed, and which stages need an Opus review. Defaults in questions.md for any product choice."

### Decisions

- **D1 — The clone tag is the tag the live stack runs** (`current=` in the release state file at drill time), when that tag carries `wait_db_tcp` (`v0.4.2` or later). Reason: the drill restores a backup of the live database and then migrates at the clone's tag; with the same tag, the migrate step applies nothing, so the drill proves the restore path the operator would use for that live data. Rejected: a fixed `v0.4.3` (after the `v0.4.4` release the dump holds the `v0.4.4` schema, and an older tag would meet migrations it does not know); a clone of `master` (`EA_RELEASE=dev`, not a release). If `current` is older than `v0.4.2` (a rollback), stop and record "no release carries the wait", default, owner to confirm (Q1).
- **D2 — No drill next to a release run.** Stage 01 starts only when the release state file shows `pending=` empty, no `deploy/release.sh` or `deploy/rollback.sh` process runs on the host, and the 30-minute watch of the last release has ended. Reason: both run `deploy/backup.sh` and Docker builds; the board allows one VPS deploy at a time, and a drill that measures restore time on a busy host gives a false number. The coordinator task says `v0.4.4` is being released now: stage 01 waits for that release job to end. Rejected: run in parallel (separate Compose project, but shared CPU, disk and the backup lock).
- **D3 — Time window:** not between 03:00 and 04:00 host time (the `30 3 * * *` backup cron). Free disk on `/` at least 5 GB before the start (`df -h /`); else stop and record. Default, owner to confirm (Q2).
- **D4 — Fresh volume is a precondition, not a step to skip.** `docker volume ls -q --filter name=ea-drill_` must print nothing before the drill run. With a leftover volume: `--init-env`, then `--down`, then check again, then `--init-env` again (the order of the ticket text; `--down` refuses with no `deploy/drill.env`). Never remove a volume or an image by hand.
- **D5 — One run, no rerun.** Any `restore failed at <step>` or a missing `db ready probes=` line is the result. Keep the stack up for a look, save `$C logs db` (no secret: the drill passwords are only in `drill.env`, never printed), then `--down`, record the failure, and the coordinator files a new ticket with the failure line. `docs/known-alerts.md` then says `open: drill 2 failed at <step>, <date>`.
- **D6 — Probe count meaning.** `probes=<p>` with `p` > 1 shows the init server was seen and the wait held. `p` = 1 means the final server was ready at the first probe: the drill still passes (the acceptance is `restore ok` at the first run); the record says the init phase was not seen, and test F139-1 still proves the wait.
- **D7 — The record proves V4 of the production ticket.** The live tag holds `deploy/compose-lib.sh` and the `migrate` service (from `v0.4.3`), so the record states "migrate service path ran on a host". F108 stage 07 cites it (its § Restore, V4).
- **D8 — Stage 02 is test-only hardening** (the F139 review note). F139-2 (new-host) gains the two asserts that F139-1 has for the drill target: 3 `sleep 1` calls and every probe after the `up -d --wait db` call. No change to `deploy/restore.sh`. Rejected: leaving it out (it costs one small job; the ticket text names it).

### Edge cases (answers)

- Leftover drill volume or `drill.env` from an old run: D4.
- Release in flight or a rollback during the drill: D2; a rollback that starts during the drill does not touch `ea-drill`, but the record then names it.
- Live data changes during the drill: counts must lie between before and after (README § Drill step 4).
- Age key: decrypt only on the owner's machine (this PC); the key and the plain dump never touch the VPS disk.
- Secrets: no password, key line or dump byte in a log, a record or a chat. `--init-env` prints only a summary line.

## Facts checked (2026-11-20, code at fb1df6d64)

- `git tag --contains 38180f555` lists `v0.4.2` and `v0.4.3`; HEAD is the "Release v0.4.4" commit, not tagged yet (scout 1).
- `git diff v0.4.3 HEAD` on `deploy/restore.sh`, `deploy/compose*.yaml` and `deploy/compose-lib.sh` is empty (scout 1).
- `deploy/restore.sh`: `set_compose` refuses for the drill target when `deploy/drill.env` is missing, also for `--down`; `init_env` refuses when `drill.env` exists; `--init-env` reads only `CREDENTIALS_KEY` and `CREDENTIALS_KEY_VERSION` from the live `.env` (read here). After the env split these keys stay in `.env` (only the three database passwords move to `deploy/db.env`, `deploy/env-split.sh`).
- `deploy/test/restore.test.ts`: F139-1 asserts `sleepCalls()` and probe order after `up`; F139-2 asserts neither (read here).
- The queue note holds one drill record (2026-11-19, `v0.3.1`); `v0.4.3` released 2026-11-20 19:28Z, watch clean (read here).

## Not verified

- The real `probes=<p>` value on the VPS and the drill time at the live tag: stage 01 records them.
- Whether origin has a `v0.4.4` tag at drill time: stage 01 reads the state file, not the tag list.

## Done when

- Ticket § Acceptance (5 items).

## Rules for every stage

- A gap or a deviation from a decision is a question in the final message, not a choice.
- Stage 01: never touch the live project `email-assistant`, never a Compose profile with the drill files, never a rerun.
- Stage 02: edit only `deploy/test/restore.test.ts`; format only that file.
- No secret, password, key line or dump byte in a log, a record or the final message.

## Proof

Stage 02: the last line of `bun run check:job` (`check:job PASS master=… tip=…`). Stage 01 has no code proof; its proof is the record (stage 01 § Pass).

## User checkpoints and steps

None. Stage 01 is a pre-approved coordinator VPS run (`CLAUDE.md` § VPS, owner 2026-11-20).

## Review

- Stage 01: no review job. It changes no code; the record is checked against stage 01 § Pass by the coordinator.
- Stage 02: no Opus review. Test-only, one file, not `[risky]`; it lands on its `check:job` line.

## Stages

- [ ] [stage 01 — drill rerun on the VPS and the record](stages/stage-01-vps-drill-rerun.md) (coordinator, VPS; not `[risky]`: separate project, no live change)
- [ ] [stage 02 — F139-2 asserts pauses and probe order](stages/stage-02-new-host-wait-asserts.md) (worker)

## How to run (coordinator)

Stage 01: the coordinator runs it on the VPS when D2 holds (after the `v0.4.4` release job ends). Stage 02, at any time:

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking medium \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "new-host restore wait asserts · F152" \
  'Implement F152 stage 02. Read spec/features/active/F152-the-restore-drill-rerun-on-the-release-that-carries-the-tcp-wait-ends-with-restore-ok-at-the-first-run/ticket.md, plan.md and stages/stage-02-new-host-wait-asserts.md. Final proof: the last line of bun run check:job.'
```

Land stage 02 with `--keep-open` if stage 01 has no record yet. The last of the two closes the ticket.

## Planning progress

- Scouts: 2 (`scouts.md`).
- [written] ticket.md, plan.md, stages/stage-01-vps-drill-rerun.md, stages/stage-02-new-host-wait-asserts.md, questions.md.
- Word counts (`wc -w`, before the review): plan.md 1392, stage-01 694, stage-02 287.

## Cold review

See § Log.

## Log

- 2026-11-20: plan written at fb1df6d64.
