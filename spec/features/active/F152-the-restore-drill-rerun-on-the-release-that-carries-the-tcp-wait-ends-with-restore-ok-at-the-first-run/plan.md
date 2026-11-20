# F152 plan — restore drill rerun on a release with the TCP wait

> **Status 2026-11-20 — planned.** Plan base: fb1df6d64. Two stages: 01 coordinator VPS drill and record, 02 worker test hardening. They may run at the same time. No migration, no `bun.lock` change.

## Input

Ticket text (from F139 stage 02, word for word): "after release v0.4.2 (carries F139 stage 01, commit 38180f55), run the drill in project `ea-drill` on a fresh volume as `deploy/README.md` § Drill says: check first that no `ea-drill_` volume is left (`docker volume ls --filter name=ea-drill_`; with a leftover volume, run `--init-env` then `restore.sh --target drill --down` — in a fresh clone there is no `deploy/drill.env`, so `--down` refuses without it), run once, no rerun on failure. Expected: `restore ok`, a line `db ready probes=<n>`. Write the result into the drill record (`deploy/README.md` § VPS lost, `notes/2026-11-15-vps-deploy-queue.md`) and set `docs/known-alerts.md` § restore drill to fixed. Optional hardening from review 1: F139-2 asserts the 3 `sleep` calls. Build after: release v0.4.2 is deployed."

Coordinator task (2026-11-20): "release v0.4.3 is live on the VPS; v0.4.4 (two migrations) is being released now. Name Build after, risk marks, whether a migration or bun.lock change is needed, and which stages need an Opus review. Defaults in questions.md for any product choice."

### Decisions

- **D1 — The clone tag `T` is the live tag:** `current=` in `deploy/release-state/state` at drill time. `T` must carry `wait_db_tcp` (`v0.4.2` or later), and its newest `db/migrations` file must equal the newest `schema_migrations` version of the live database (a rollback after a migrate step keeps the newer schema, `deploy/rollback.sh`). Else stop and record (Q1). Reason: the drill restores the live dump, then migrates at `T`; with the same schema the migrate step applies nothing. Rejected: a fixed `v0.4.3` (after `v0.4.4` the dump has a newer schema); `master` (`EA_RELEASE=dev`).
- **D2 — No drill next to a release run.** Start only when `pending=` is empty, no `release.sh` or `rollback.sh` process runs, and the last release's 30-minute watch has ended. Reason: one VPS deploy at a time; both run `backup.sh` and builds, and a busy host gives a false restore time. So stage 01 waits for the `v0.4.4` release job. Rejected: run in parallel. A running `ea-sim` stays up (CPU only); the record names its state.
- **D3 — Window and disk:** not 03:00–04:00 host time (backup cron `30 3`); at least 5 GB free on `/`. Default, owner to confirm (Q2).
- **D4 — Fresh volume is a precondition.** `docker volume ls -q --filter name=ea-drill_` prints nothing before the run. With a leftover volume: `--init-env`, `--down`, check again, `--init-env` (`--down` refuses with no `deploy/drill.env`). Never remove a volume or image by hand.
- **D5 — One run, no rerun.** Any `restore failed at <step>` or a missing `db ready probes=` line is the result, except an operator error (D10). Keep the stack up, save `$C logs db` (no secret), `--down`, record, and file a new ticket with the failure line. `docs/known-alerts.md`: `open: drill 2 failed at <step>, <date>`.
- **D6 — Probe meaning.** `p` > 1: the init server was seen and the wait held. `p` = 1: the drill passes, the record says the init phase was not seen; test F139-1 still proves the wait.
- **D7 — The record proves V4 of the production ticket.** Every tag D1 allows has `deploy/compose-lib.sh` and the `migrate` service (both since `v0.4.2`), so the record says "the `migrate` service path ran on a host". F108 stage 07 cites it.
- **D8 — Stage 02 is test-only hardening** (the F139 review note). F139-2 (new-host) gains the asserts F139-1 has: 3 `sleep 1` calls, every probe after the `up -d --wait db` call, plus the `up` index ≥ 0 (else the order check passes on a missing call). Break checks: delete the `sleep 1` line (F139-1 and F139-2 fail); move the `wait_db_tcp` call before `up` (F139-2 fails). No change to `deploy/restore.sh`. Rejected: leave it out (one small job; the ticket text names it).
- **D9 — The pre-drill backup uses the cron `PATH`:** `PATH=$HOME/bin:$PATH deploy/backup.sh`. Reason: an `ssh` shell runs apt `rclone` 1.53.3, which fails at the B2 login, writes `result=failed` and fires the live backup alert. On a failure: fix, run once more; on a second failure stop and record.
- **D10 — Operator errors are not the drill result.** The age key on this PC is `~/.config/ea-backup/age-key.txt` (the README example `~/ea-backup-key.txt` does not exist). A dry decrypt to `/dev/null` runs first. A failure of the backup, the dry check, `age` in the pipe or `ssh` is an operator error: fix, `--down`, fresh volume, `--init-env`, run again. Reason: an empty stdin passes `db-ready` and fails at `pg_restore`, a false drill failure.

### Edge cases (answers)

- Leftover volume or `drill.env`: D4. Release or rollback in flight: D1, D2.
- Live data changes during the drill: drill counts lie between before and after (README § Drill step 4).
- Secrets: the key and the plain dump stay on this PC; the encrypted copy goes to a temp folder, deleted at the end. No password, key line or dump byte in a log, a record or a chat.

## Facts checked (2026-11-20, code at fb1df6d64)

- `git tag --contains 38180f555` lists `v0.4.2`, `v0.4.3`; HEAD is the untagged "Release v0.4.4" commit. `git diff v0.4.3 HEAD` on `deploy/restore.sh`, `deploy/compose*.yaml`, `deploy/compose-lib.sh` is empty (scout 1, review 1).
- `deploy/restore.sh`: the drill target refuses with no `drill.env`, also for `--down`; `--init-env` refuses when `drill.env` exists and reads only the `CREDENTIALS_KEY` lines, which stay in `.env` after the env split (`deploy/env-split.sh` moves only the three passwords).
- `deploy/test/restore.test.ts`: F139-1 asserts pauses and probe order; F139-2 neither. The new-host `up` call holds ` up -d --wait db` (review 1).
- `v0.4.2` has the `migrate` service (review 1 N7). Age key path: `notes/owner-later.md` § 4. Backup `PATH` fault: queue note, F108 stage 04 step 5.

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

Move the folder to `active/` and commit before the first spawn. Stage 01: the coordinator runs it on the VPS when D2 holds (after the `v0.4.4` release job ends). Stage 02, at any time:

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
- Word counts (`wc -w`, after the review fixes): plan.md 1498, stage-01 698, stage-02 314.

## Cold review

One round, `claude-opus-5-5` at `high`: no stage is `[risky]`, but the plan touches the deploy and VPS restore path, a risk area (`spec/build.md` standing models). Verdict FAIL, 1 blocking, 9 notes (`plan-review-1.md`). All fixed, none rejected: B1 → D10 and stage 01 step 4 (real key path, dry decrypt, operator error); N1 → D9; N2 → D1 schema check; N3, N4 → D8 and stage 02 (index ≥ 0, two break checks); N5, N8 → ticket wording; N6 → record heading names F139, plus an F108 stage 07 edit in the final message; N7 → D7; N9 → state file path, clone from origin, temp-folder cleanup, `ea-sim` note, move to `active/` before the spawn.

## Log

- 2026-11-20: plan written at fb1df6d64; cold review FAIL (1 blocking, 9 notes), all fixed.
