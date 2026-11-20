# F152 plan review 1

Job `2026-11-20-f152-plan-review-1fd8fda0`, `claude-opus-5-5` at `high`, candidate `95533057e`. Final message filed whole below.

FAIL 95533057ee28e6fb4b6cddfc39700718dba6dbbc

HEAD matches the candidate (`git rev-parse HEAD` printed `95533057e…`). The tree is clean (`git status --short` printed nothing). This was a read-only plan review. I ran no test suite, lint, typecheck or test file.

## Blocking

**B1 — The decrypt command in stage 01 uses an age key path that does not exist, and the one-run rule turns that operator error into the drill result (proven: `ls` plus two notes).**
- The command is at `stages/stage-01-vps-drill-rerun.md:19`: `age -d -i ~/ea-backup-key.txt <file>.dump.age | ssh …`.
- On this PC, `ls ~/ea-backup-key.txt` printed "No such file".
- The key is at `~/.config/ea-backup/age-key.txt`. Sources: `notes/owner-later.md:41` ("U1 done") and `notes/2026-11-03-pilot-vps.md:26` ("not `~/ea-backup-key.txt` as the runbook example says").
- If the coordinator copies the step as written, `age` fails on the PC and ssh still starts `restore.sh` with an empty stdin. The script passes `guard`, `db`, `db-ready`, `guard-empty` and `build`, then fails at `pg_restore` (`deploy/restore.sh:222-224`).
- D5 (`plan.md:17`) and ticket Scope (`ticket.md:13`, "Run once, no rerun on failure") make that the recorded result. Acceptance bullet 1 (`ticket.md:24`, `restore ok` at the first run) then fails for a reason unrelated to the restore.
- Fix: name the real key path in the stage. Add a dry check before the run: `age -d -i <key> <file> >/dev/null` on the PC writes nothing to disk. Say in D5 that a failure before `restore.sh` starts, or one caused by the decrypt pipe, is an operator error. It is not the drill result.

## Unverified

None of the plan's VPS-side facts could be checked from here: the live state file, the VPS PATH, the sim stack status and the free disk.

## Notes

**N1 — The manual backup in stage 01 does not set `PATH=$HOME/bin:$PATH` (plausible; the cause is proven in the queue note).**
- `stages/stage-01-vps-drill-rerun.md:16` says "run `deploy/backup.sh`".
- `notes/2026-11-15-vps-deploy-queue.md:142` proves that an `ssh home_vm 'cmd'` shell runs the apt rclone 1.53.3, and that this rclone fails at the B2 login. The fix is recorded at `docs/known-alerts.md:1120` and `deploy/README.md:1086`.
- `deploy/backup.sh` does not set PATH itself. Only `deploy/release-lib.sh:16` does that.
- A failed run writes `result=failed` to the live status file. `deploy/backup.sh:23,122` say "the backup alert fires", so the live operator sees an alert. A failed copy also leaves no local `.dump.age` (`backup.sh:153`), so the drill has no input.
- No rule covers a failed pre-drill backup: D5 covers only the restore. This is the most likely way the drill reaches the live stack.

**N2 — D1 does not cover a rollback that leaves the live schema ahead of `current=` (plausible).**
- `deploy/rollback.sh:3` says "The schema stays: no migration step". `v0.4.4` holds the contract migration `db/migrations/20261120110001_drop_old_cursor_columns.sql`.
- If the `v0.4.4` release fails after its migrate step and the coordinator rolls back, the state shows `current=v0.4.3` and an empty `pending=`. D2 passes, and D1 (`plan.md:13`) picks T=`v0.4.3`.
- The drill then restores a `v0.4.4` schema into `v0.4.3` code. That is the case D1 itself rejects ("an older tag would meet migrations it does not know").
- Add a rule: T must be the tag whose last migration equals the newest row of `schema_migrations` in the live database. If the two differ, stop and record.

**N3 — The new "probes after `up`" assert in stage 02 can pass when the `up` call is missing (plausible, by reading).**
- `stages/stage-02-new-host-wait-asserts.md:16` copies the F139-1 check. In F139-1, `indexOfCall` returns -1 when nothing matches (`deploy/test/restore.test.ts:136-137`), and `expect(index).toBeGreaterThan(up)` at `:562` then always passes.
- The stage should also assert `up >= 0`.
- The break check (`stage-02:20`) breaks only the pause. The order assert has no failing case. Ticket acceptance (`ticket.md:28`) names both asserts.
- Add a second break, for example move `wait_db_tcp` before the `up` call, or name the gap.

**N4 — The stage 02 break check does not match the ticket acceptance (proven by the text).**
- `ticket.md:28` says the test "fails when the wait has no pause".
- `stage-02:20` changes `sleep 1` to `sleep 2`. That proves the exact pause text, not the case with no pause.
- Fix: delete the `sleep` line instead, or reword the acceptance bullet.

**N5 — The ticket calls the hardening optional but makes it acceptance (proven by the text).**
- `ticket.md:15` says "Optional hardening". `ticket.md:28` makes it a required acceptance bullet.
- D8 and Q3 settle it as "yes". The Scope word should say so.

**N6 — The production ticket's final stage still waits for a "F139 drill rerun" (plausible ticket drift; not repaired here).**
- `spec/features/active/F108-e7-t5-production-on-the-vps/stages/stage-07-final-checkpoint.md:9,32` waits for "the F139 drill rerun".
- D7 (`plan.md:19`) says F108 stage 07 cites the F152 record, but no F152 stage updates that pointer.
- The record heading "Restore drill record 2 (<date>, F152)" should name both features, or F108 stage 07 needs a one-line fix.

**N7 — D7 and scout 1 misdate the `migrate` service (proven; harmless).**
- D7 (`plan.md:19`) says "from `v0.4.3`". Scout 1 item 5 (`scouts.md:40`) says `v0.4.2` lacks `migrate`.
- `git show v0.4.2:deploy/compose.yaml | grep -c "^  migrate:"` printed 1. `v0.4.2` also has `deploy/compose-lib.sh` and `run --rm -T migrate` (`v0.4.2:deploy/restore.sh:249`).
- The V4 claim of D7 therefore holds at any T that D1 allows. Only the stated source is wrong.

**N8 — D6 lets `probes=1` pass, but the outcome says the rerun "proves" the wait (plausible overclaim).**
- D6 is at `plan.md:18`. The outcome claim is at `ticket.md:9`.
- With `probes=1`, the run never saw the init server, so the record cannot claim that the wait held on a host.
- The record wording should say this. D6 already notes it; the ticket outcome does not.

**N9 — Small gaps a coordinator must guess (plausible; none blocks).**
- The state file path is not named. It is `deploy/release-state/state` (`deploy/release-lib.sh:6-7`).
- The clone source is not named. F114 cloned from origin (`spec/features/done/2026-11/F114-…/stages/stage-09-vps-release-and-drill.md:29`).
- No cleanup removes the encrypted dump copy from the PC (step 4 copies it; step 5 does not delete it). The first drill removed `/tmp/f114-drill/` (`notes/2026-11-15-vps-deploy-queue.md:74`).
- D2 does not mention a running `ea-sim` stack. It shares CPU and would skew the drill time, but not the result.
- `plan.md:80` points the stage 02 spawn prompt to `spec/features/active/…`, while the folder is in `planned/`.

## Facts checked and found right

- `--init-env` refuses when `drill.env` exists (`deploy/restore.sh:132`).
- `set_compose` refuses for the drill target when `drill.env` is missing, also for `--down` (`restore.sh:107`, `:293`).
- The order in D4 is sound.
- `--init-env` reads only the `CREDENTIALS_KEY` lines. `env-split.sh:132,154` moves only the three database passwords.
- The new-host `up` call contains the text ` up -d --wait db` (`restore.test.ts:539-541`), so the stage 02 matcher works on it.
- `pending=` is cleared on success (`release.sh:117`) and on rollback (`rollback.sh:69`).
- `git diff --stat v0.4.3 HEAD` on `restore.sh`, the compose files, `compose-lib.sh` and `backup.sh` is empty.
- The drill and sim subnets differ (`compose.drill.yaml:75`, `compose.sim.yaml:146`).
- Neither stage is too big for one job.

## Checks run

- `git rev-parse HEAD`: matched the candidate.
- `git status --short`: empty.
- `ls ~/ea-backup-key.txt`: not found.
- `git show v0.4.2:deploy/compose.yaml | grep -c "^  migrate:"`: 1.
- `git diff --stat v0.4.3 HEAD -- deploy/restore.sh deploy/compose*.yaml deploy/compose-lib.sh deploy/backup.sh`: empty.
- `git diff --stat v0.4.3 HEAD -- db/migrations`: 2 files, one of them `drop_old_cursor_columns`.
- I read the code with greps.

## Note check

- HEAD equals the candidate: proven. `git rev-parse HEAD` (a single call) printed `95533057ee28e6fb4b6cddfc39700718dba6dbbc`.
- The plan claims were checked against the code: proven. I read the files `deploy/restore.sh`, `deploy/test/restore.test.ts`, `deploy/README.md` (§ VPS lost, lines 1112-1145), `deploy/release-lib.sh`, `deploy/release.sh`, `deploy/rollback.sh` and `deploy/backup.sh`. Each finding above cites file:line.
- The final message lists the findings with labels and file:line: not proven by the Limen proof rule. The evidence is this message, which is not a file or a command. The coordinator files it as `review-<n>.md`.
- Easy-to-miss rule ("Read-only: edit nothing"; a review job runs no suite, lint or typecheck): followed. `git status --short` (a single call) printed nothing. I ran no `test:*`, `bun test`, lint or typecheck. The only file I wrote is the job note outside the worktree, which the Limen prompt requires.

## Project reminders

- Tests run once per job, and no forbidden suite: followed. I ran no test command.
- `check:job` for product-code jobs: not applicable. This is a review job, and it committed nothing.
- A review job runs no test suite, lint or typecheck: followed. I ran none.
- Never delete `node_modules/.cache/`: followed. I did not touch it.
